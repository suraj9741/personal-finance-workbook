'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./load');

function setup() {
  const P = loadProject();
  const ss = P.gas.globals.SpreadsheetApp.create('Test');
  P.ctx.__ss = ss;
  P.run('buildNewWorkbook(__ss)');
  P.gas.state.active = ss._self || P.gas.state.active;
  return { P, ss, d: ss.getSheetByName('Data'), add: p => P.g('addQuickTransaction')(p, ss) };
}

test('Quick Add writes to the first empty row', () => {
  const { d, add } = setup();
  d.getRange('A2:A3').setValues([[new Date(2027, 0, 1)], [new Date(2027, 0, 2)]]);
  const msg = add({ date: '2027-02-03', desc: 'Lunch', amount: '120.5', type: 'Expense', category: 'Everyday → Food', account: 'Bank → HDFC' });
  assert.equal(msg, 'Saved row 4: Expense ₹120.5');
  assert.equal(d.getRange('C4').getValue(), 'Lunch');
  assert.equal(d.getRange('D4').getValue(), 120.5);
  assert.equal(d.getRange('E4').getValue(), 'Expense');
  assert.equal(d.getRange('F4').getValue(), 'Everyday → Food');
  assert.equal(d.getRange('I4').getValue(), 'Bank → HDFC');
  assert.equal(d.getRange('L4').getValue(), '', 'no To Account for an expense');
  const dt = d.getRange('A4').getValue();
  assert.deepEqual([dt.getFullYear(), dt.getMonth(), dt.getDate()], [2027, 1, 3]);
});

test('Quick Add never overwrites the auto-fill formula columns', () => {
  const { d, add } = setup();
  const before = d.getRange('B2').getFormula();
  add({ date: '2027-02-03', amount: 1, type: 'Expense', category: 'x', account: 'y' });
  assert.equal(d.getRange('B2').getFormula(), before);
  assert.equal(d.getRange('G2').getFormula() !== '', true);
});

test('Quick Add transfer fills the To Account', () => {
  const { d, add } = setup();
  add({ date: '2027-02-03', amount: 5000, type: 'Transfer', category: 'Self Transfer → Bank to Credit',
    account: 'Bank → HDFC', toAccount: 'Credit Card → HDFC CC' });
  assert.equal(d.getRange('L2').getValue(), 'Credit Card → HDFC CC');
});

test('Quick Add: bad amount becomes 0, missing date becomes today', () => {
  const { d, add } = setup();
  const msg = add({ amount: 'abc', type: 'Expense', category: 'x', account: 'y' });
  assert.match(msg, /Expense ₹0$/);
  assert.equal(d.getRange('D2').getValue(), 0);
  assert.equal(d.getRange('A2').getValue().toDateString(), new Date().toDateString());
});

test('Quick Add fails clearly when Data is missing', () => {
  const { P, ss } = setup();
  ss.deleteSheet(ss.getSheetByName('Data'));
  assert.throws(() => P.g('addQuickTransaction')({ type: 'Expense' }, ss), /Data sheet missing/);
});

test('form lists come from Config and skip blanks', () => {
  const { P, ss } = setup();
  const cfg = ss.getSheetByName('Config');
  cfg.getRange('Y2:Y4').setValues([['Debt → EMI'], [' Home → Rent '], ['']]);
  cfg.getRange('R2:R3').setValues([['Bank → HDFC'], ['Cash → Cash']]);
  const f = P.g('getFormData_')(ss);
  assert.deepEqual([...f.Expense], ['Debt → EMI', 'Home → Rent']);
  assert.deepEqual([...f.accounts], ['Bank → HDFC', 'Cash → Cash']);
  const empty = P.g('getFormData_')(P.gas.globals.SpreadsheetApp.create('no config'));
  assert.deepEqual(JSON.parse(JSON.stringify(empty)), { Expense: [], Income: [], Transfer: [], accounts: [] });
});

test('sidebar HTML cannot be broken by a category name', () => {
  const { P } = setup();
  const html = P.g('quickAddHtml_')({ Expense: ['</script><script>alert(1)</script>'], Income: [], Transfer: [], accounts: [] });
  assert.ok(!html.includes('</script><script>alert(1)'), 'category text must be escaped inside the page script');
  assert.ok(html.includes('\\u003c/script>'));
});
