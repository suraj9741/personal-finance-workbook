'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./load');

function built() {
  const P = loadProject();
  const ss = P.gas.globals.SpreadsheetApp.create('Test');
  P.ctx.__ss = ss;
  P.run('buildNewWorkbook(__ss)');
  return { P, ss, CONFIG: P.g('CONFIG'), names: () => ss.getSheets().map(s => s.getName()) };
}

test('Build New Workbook creates every sheet in the right order', () => {
  const { ss, CONFIG, names } = built();
  const months = CONFIG.MONTHS.map(m => m + '_' + CONFIG.YEAR);
  assert.deepEqual(names().slice(0, 16), ['Config', 'Data', ...months, 'Accounts', 'Annual Dashboard']);
  for (const n of ['Helper', 'Month_Template', 'Validation_Report', 'Performance_Report']) assert.ok(ss.getSheetByName(n), n);
  assert.ok(ss.getSheetByName('Helper').isSheetHidden());
  assert.ok(ss.getSheetByName('Month_Template').isSheetHidden());
});

test('Config is seeded from the defaults', () => {
  const { P, ss, CONFIG } = built();
  const cfg = ss.getSheetByName('Config');
  const exp = P.g('flat_')(P.g('DEFAULT_CATEGORIES').EXPENSE);
  assert.equal(cfg.getRange('A2').getValue(), exp[0][0]);
  assert.equal(cfg.getRange(2 + exp.length, 1).getValue(), '', 'nothing after the last category');
  assert.equal(cfg.getRange(1 + exp.length, 2).getValue(), exp[exp.length - 1][1]);
  assert.equal(cfg.getRange('D2').getValue(), 0, 'budgets start at 0');
  assert.equal(cfg.getRange('O2').getValue(), 'Bank');
  assert.equal(cfg.getRange('P2').getValue(), 'HDFC');
  assert.equal(cfg.getRange('W2').getValue(), CONFIG.YEAR);
  assert.match(cfg.getRange('C2').getFormula(), /ARRAYFORMULA/);
});

test('Data sheet has headers, auto-fill formulas and dropdowns', () => {
  const { ss } = built();
  const d = ss.getSheetByName('Data');
  assert.deepEqual(d.getRange('A1:F1').getValues()[0], ['Date', 'Month', 'Description', 'Amount', 'Type', 'Category']);
  assert.match(d.getRange('B2').getFormula(), /TEXT\(A2:A\d+,"mmm"\)&"_"&YEAR/);
  for (const a1 of ['G2', 'H2', 'J2', 'K2', 'M2', 'N2', 'P2', 'Q2', 'R2', 'S2', 'T2']) assert.ok(d.getRange(a1).getFormula(), a1);
  const type = d.getRange('E5').getDataValidation();
  assert.equal(type.getCriteriaType(), 'VALUE_IN_LIST');
  assert.deepEqual([...type.getCriteriaValues()[0]], ['Expense', 'Income', 'Transfer']);
  assert.equal(d.getRange('I5').getDataValidation().getCriteriaType(), 'VALUE_IN_RANGE');
  assert.equal(d.getRange('F5').getDataValidation(), null, 'Category has no list until a Type is chosen');
});

test('month sheets get their own title, tag and carry-forward', () => {
  const { ss, CONFIG } = built();
  const Y = CONFIG.YEAR;
  const jan = ss.getSheetByName('Jan_' + Y), feb = ss.getSheetByName('Feb_' + Y);
  assert.equal(jan.getRange('A1').getValue(), 'Jan ' + Y);
  assert.equal(feb.getRange('B1').getValue(), 'Feb_' + Y);
  assert.match(jan.getRange('C4').getFormula(), /"Income"/);
  assert.match(jan.getRange('E4').getFormula(), /"Expense"/);
  assert.match(feb.getRange('U9').getFormula(), new RegExp(`'Jan_${Y}'!X9:X88`), 'Feb starting = Jan remaining');
  assert.doesNotMatch(jan.getRange('U9').getFormula(), /_\d{4}'!/, 'Jan starts from Config opening');
  assert.match(feb.getRange(3, 32).getFormula(), new RegExp(`#gid=${jan.getSheetId()}`), 'nav link to Jan');
});

test('named ranges and the Validation report', () => {
  const { ss } = built();
  for (const n of ['catAll', 'catExpense', 'catIncome', 'catTransfer', 'payList', 'dataTable']) assert.ok(ss.getRangeByName(n), n);
  assert.equal(ss.getRangeByName('catExpense').getA1Notation().split(':')[0], 'Y2');
  const rows = ss.getSheetByName('Validation_Report').getDataRange().getValues();
  assert.deepEqual(rows.filter(r => r[0] === 'ERROR'), []);
});

test('a second build (BACKUP mode) keeps your Config edits and backs sheets up', () => {
  const { P, ss } = built();
  const cfg = ss.getSheetByName('Config');
  cfg.getRange('D2').setValue(1234);
  cfg.getRange('A900').setValue('My Parent'); cfg.getRange('B900').setValue('My Sub');
  P.run('buildNewWorkbook(__ss)');
  assert.equal(cfg.getRange('D2').getValue(), 1234, 'budget kept');
  assert.equal(cfg.getRange('A900').getValue(), 'My Parent', 'custom category kept');
  assert.ok(ss.getSheets().some(s => /^Data_Backup_/.test(s.getName())), 'Data backed up before rebuild');
});

test('Config deleted defaults are re-added at the end, nothing else changes', () => {
  const { P, ss } = built();
  const cfg = ss.getSheetByName('Config');
  const last = cfg.getRange('A2:A').getValues().filter(r => r[0] !== '').length + 1;
  cfg.getRange(last, 1, 1, 2).setValues([['', '']]);     // remove the final default category
  P.run('buildConfig_(__ss)');
  assert.notEqual(cfg.getRange(last, 1).getValue(), '', 'missing default appended');
});

test('Resume rebuilds only what is missing', () => {
  const { P, ss, CONFIG } = built();
  const jan = ss.getSheetByName('Jan_' + CONFIG.YEAR);
  ss.deleteSheet(ss.getSheetByName('Apr_' + CONFIG.YEAR));
  P.run('validateWorkbook(__ss)');
  const errs = ss.getSheetByName('Validation_Report').getDataRange().getValues().filter(r => r[0] === 'ERROR');
  assert.deepEqual(errs.map(r => r[2]), ['Apr_' + CONFIG.YEAR]);
  P.run('resumeBuild(__ss)');
  assert.ok(ss.getSheetByName('Apr_' + CONFIG.YEAR));
  assert.equal(ss.getSheetByName('Jan_' + CONFIG.YEAR), jan, 'Jan untouched');
  assert.equal(ss.getSheets().filter(s => s.getName() === 'Jan_' + CONFIG.YEAR).length, 1);
});

test('SKIP mode leaves existing sheets alone', () => {
  const { P, ss } = built();
  ss.getSheetByName('Data').getRange('C2').setValue('keep me');
  P.run('CONFIG.REBUILD_MODE = "SKIP"; buildNewWorkbook(__ss); CONFIG.REBUILD_MODE = "BACKUP";');
  assert.equal(ss.getSheetByName('Data').getRange('C2').getValue(), 'keep me');
});

test('Validate flags an empty Config', () => {
  const { P, ss } = built();
  ss.getSheetByName('Config').getRange('A2').setValue('');
  ss.getSheetByName('Config').getRange('P2').setValue('');
  P.run('validateWorkbook(__ss)');
  const errs = ss.getSheetByName('Validation_Report').getDataRange().getValues().filter(r => r[0] === 'ERROR').map(r => r[2]);
  assert.deepEqual(errs.sort(), ['No accounts', 'No expense categories']);
});

test('building installs exactly one onEdit trigger, and none during tests', () => {
  const { P } = built();
  P.run('buildNewWorkbook(__ss)');
  const t = P.gas.state.triggers.map(x => x.getHandlerFunction());
  assert.deepEqual(t, ['onEditInstallable']);
  P.gas.state.triggers = [];
  P.run('TEST_MODE_ = true; installTriggers_(__ss); TEST_MODE_ = false;');
  assert.deepEqual(P.gas.state.triggers, []);
});

// Budget vs Actual: every row has a live Diff, both tables have a total row (row 7), and Diff
// points the same way in both (positive = good: money left on expenses, extra on income).
test('Budget vs Actual: Diff on every row and a total with its own Diff, every month', () => {
  const { ss, CONFIG } = built();
  for (const m of CONFIG.MONTHS) {
    const sh = ss.getSheetByName(m + '_' + CONFIG.YEAR), f = a1 => sh.getRange(a1).getFormula();
    // Expense (A–E): Diff = Budget − Spent for rows 9–154, the whole list.
    assert.equal(f('E9'), '=ARRAYFORMULA(IF(A9:A154="","",IFERROR(C9:C154-D9:D154,0)))', m + ' expense Diff');
    assert.equal(f('C7'), '=SUM(C9:C154)', m + ' expense total budget');
    assert.equal(f('D7'), '=SUM(D9:D154)', m + ' expense total spent');
    assert.equal(f('E7'), '=C7-D7', m + ' expense total Diff');
    // Income (H–L): Diff = Earned − Budget for rows 9–60.
    assert.equal(f('L9'), '=ARRAYFORMULA(IF(H9:H60="","",IFERROR(K9:K60-J9:J60,0)))', m + ' income Diff');
    assert.equal(f('J7'), '=SUM(J9:J60)', m + ' income total planned');
    assert.equal(f('K7'), '=SUM(K9:K60)', m + ' income total earned');
    assert.equal(f('L7'), '=K7-J7', m + ' income total Diff');
    // Totals sit beside the titles, not on top of them.
    assert.match(sh.getRange('A7').getValue(), /^EXPENSE/);
    assert.match(sh.getRange('H7').getValue(), /^INCOME/);
    assert.equal(sh.getRange('B7').getValue(), '');
    assert.equal(sh.getRange('I7').getValue(), '');
  }
});

test('Budget vs Actual: Diff columns are not hard-coded values', () => {
  const { ss, CONFIG } = built();
  const sh = ss.getSheetByName('Jan_' + CONFIG.YEAR);
  for (let r = 10; r <= 154; r++) assert.equal(sh.getRange('E' + r).getValue(), '', 'E' + r + ' left free for the E9 formula to fill');
  for (let r = 10; r <= 60; r++) assert.equal(sh.getRange('L' + r).getValue(), '', 'L' + r + ' left free for the L9 formula to fill');
});
