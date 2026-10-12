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
