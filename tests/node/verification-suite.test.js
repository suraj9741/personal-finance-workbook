'use strict';
// The in-sheet suite needs real Google Sheets to calculate formulas, so here we only check
// that its own code runs end to end without crashing and that it cleans up after itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./load');

test('runVerificationTests runs every group without crashing and never touches the host workbook', () => {
  const P = loadProject();
  const host = P.gas.active;
  const CONFIG = P.g('CONFIG');
  const saved = [CONFIG.WORKBOOK_NAME, CONFIG.DRIVE_FOLDER_ID];
  const result = P.g('runVerificationTests')();
  const rep = host.self.getSheetByName('Test_Report');
  assert.ok(rep, 'report written to the host workbook');
  const rows = rep.getRange(3, 1, result.total, 5).getValues();
  const crashed = rows.filter(r => r[1] === '(group stopped early)');
  assert.deepEqual(crashed, [], 'a test group crashed: ' + JSON.stringify(crashed));
  assert.equal(new Set(rows.map(r => r[0])).size, 16, 'all 16 groups ran');
  assert.ok(result.total > 120, 'expected 120+ checks, got ' + result.total);
  assert.deepEqual(host.sheets.map(s => s.name).sort(), ['Sheet1', 'Test_Report'], 'host workbook only gains Test_Report');
  assert.equal(P.gas.state.created.length, 1, 'one throwaway workbook');
  assert.equal(P.run('TEST_MODE_'), false);
  assert.deepEqual([CONFIG.WORKBOOK_NAME, CONFIG.DRIVE_FOLDER_ID], saved, 'CONFIG restored');
  assert.deepEqual(P.gas.state.triggers, [], 'no trigger installed');
});

// Apps Script stops a run at 6 minutes. With a negative time budget the suite pauses after every
// group, which is the worst case: it must still finish, via Resume, with the same results.
function reportRows(P) {
  const rep = P.gas.active.self.getSheetByName('Test_Report');
  return rep.getRange(3, 1, rep.getLastRow() - 2, 5).getValues();
}
function summary(P) { return P.gas.active.self.getSheetByName('Test_Report').getRange(1, 1).getValue(); }

test('time limit: pauses between groups and Resume finishes with the same checks', () => {
  const full = loadProject().g('runVerificationTests')().total;
  const P = loadProject();
  P.run('TEST_TIME_BUDGET_MS_ = -1');
  let r = P.g('runVerificationTests')(), runs = 1;
  assert.equal(r.paused, true);
  assert.match(summary(P), /PAUSED .* Resume Verification Tests/);
  while (r.paused) { r = P.g('resumeVerificationTests')(); runs++; assert.ok(runs <= 20, 'never finishes'); }
  assert.equal(runs, 16, 'one group per run');
  assert.equal(r.total, full, 'same number of checks as one uninterrupted run');
  assert.equal(reportRows(P).length, full, 'report holds every check exactly once');
  assert.equal(new Set(reportRows(P).map(x => x[0])).size, 16);
  assert.deepEqual(reportRows(P).filter(x => x[1] === '(group stopped early)'), []);
  assert.equal(P.gas.state.created.length, 1, 'all runs share one throwaway workbook');
  assert.equal(P.gas.state.props.size, 0, 'saved place cleared when done');
  assert.equal(P.run('TEST_MODE_'), false);
});

test('time limit: a run killed inside the build is finished by Resume', () => {
  const P = loadProject();
  const tmp = P.gas.globals.SpreadsheetApp.create('half built');
  P.g('buildConfig_')(tmp); P.g('buildData_')(tmp);          // killed after two sheets
  P.gas.state.props.set('VERIFICATION_TEST_STATE', JSON.stringify({ tmpId: tmp.getId(), next: 0, running: 0 }));
  const r = P.g('resumeVerificationTests')();
  assert.equal(r.paused, false);
  const rows = reportRows(P);
  assert.ok(rows.some(x => x[1] === 'Build needed a second run (6-minute limit)' && x[4] === 'PASS'));
  assert.deepEqual(rows.filter(x => x[1] === '(group stopped early)'), []);
  assert.equal(new Set(rows.map(x => x[0])).size, 16);
});

test('time limit: a run killed inside a later group is reported, not silently re-run', () => {
  const P = loadProject();
  P.run('TEST_TIME_BUDGET_MS_ = -1');
  let r = P.g('runVerificationTests')();
  while (r.next < 12) r = P.g('resumeVerificationTests')();   // groups 1–12 done
  const st = JSON.parse(P.gas.state.props.get('VERIFICATION_TEST_STATE'));
  P.gas.state.props.set('VERIFICATION_TEST_STATE', JSON.stringify({ ...st, running: 12 }));  // killed in group 13
  P.run('TEST_TIME_BUDGET_MS_ = 1e9');
  r = P.g('resumeVerificationTests')();
  assert.equal(r.paused, false);
  const g13 = reportRows(P).filter(x => x[0] === '13. Quick Add');
  assert.deepEqual(g13.map(x => [x[1], x[4]]), [['(stopped by the 6-minute limit)', 'FAIL']]);
  assert.ok(reportRows(P).some(x => x[0] === '16. Wrong Drive folder ID fails loudly'), 'later groups still ran');
});

test('starting a new run while one is paused trashes the old test workbook', () => {
  const P = loadProject();
  P.run('TEST_TIME_BUDGET_MS_ = -1');
  P.g('runVerificationTests')();
  const old = P.gas.state.created[0].getId();
  P.run('TEST_TIME_BUDGET_MS_ = 1e9');
  P.g('runVerificationTests')();
  assert.ok(P.gas.state.trashed.includes(old));
  assert.equal(P.gas.state.created.length, 2);
});

test('nothing runs the tests automatically: no trigger or simple trigger calls them', () => {
  const fs = require('node:fs'), path = require('node:path');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const src = walk(path.join(__dirname, '../../src')).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const handlers = [...src.matchAll(/newTrigger\(\s*'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(handlers)], ['onEditInstallable'], 'only the onEdit trigger is ever installed');
  const P = loadProject();
  for (const fn of ['onOpen', 'onEdit', 'onEditInstallable', 'handleEdit_']) {
    assert.doesNotMatch(P.g(fn).toString(), /VerificationTests|runTests_/, fn + ' must not start the tests');
  }
});
