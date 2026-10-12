'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./load');

function setup() {
  const P = loadProject();
  const ss = P.gas.globals.SpreadsheetApp.create('Test');
  P.ctx.__ss = ss;
  P.run('buildNewWorkbook(__ss)');
  const d = ss.getSheetByName('Data');
  const edit = (row, col, value) => { if (value !== undefined) d.getRange(row, col).setValue(value);
    P.g('handleEdit_')({ range: d.getRange(row, col), value, source: ss }); };
  const list = row => { const v = d.getRange(row, 6).getDataValidation(); return v ? v.getCriteriaValues()[0] : null; };
  return { P, ss, d, edit, list, toasts: () => ss.toasts.map(t => t.msg) };
}

test('choosing a Type limits Category to that type', () => {
  const { ss, edit, list } = setup();
  edit(5, 5, 'Expense'); assert.equal(list(5), ss.getRangeByName('catExpense'));
  edit(5, 5, 'Income'); assert.equal(list(5), ss.getRangeByName('catIncome'));
  edit(5, 5, 'Transfer'); assert.equal(list(5), ss.getRangeByName('catTransfer'));
});

test('changing Type clears the old Category', () => {
  const { d, edit } = setup();
  edit(5, 5, 'Expense'); d.getRange(5, 6).setValue('Debt → Car EMI');
  edit(5, 5, 'Income');
  assert.equal(d.getRange(5, 6).getValue(), '');
});

test('blank or unknown Type removes the Category list', () => {
  const { edit, list } = setup();
  edit(5, 5, 'Expense'); edit(5, 5, ''); assert.equal(list(5), null);
  edit(5, 5, 'Expense'); edit(5, 5, 'Banana'); assert.equal(list(5), null);
});

test('header row and other sheets are ignored', () => {
  const { P, ss, d, list } = setup();
  P.g('handleEdit_')({ range: d.getRange(1, 5), value: 'Expense', source: ss });
  assert.equal(list(1), null);
  const cfg = ss.getSheetByName('Config');
  assert.doesNotThrow(() => P.g('handleEdit_')({ range: cfg.getRange(5, 5), value: 'Expense', source: ss }));
  assert.doesNotThrow(() => P.g('handleEdit_')(undefined));
  assert.doesNotThrow(() => P.g('handleEdit_')({}));
});

test('warns about incomplete rows, in order', () => {
  const { d, edit, toasts } = setup();
  edit(6, 4, 100);
  assert.match(toasts().pop(), /choose a Type first/);
  d.getRange(6, 5).setValue('Expense'); edit(6, 4);
  assert.match(toasts().pop(), /pick a Category/);
  d.getRange(6, 6).setValue('Debt → Car EMI'); edit(6, 4);
  assert.match(toasts().pop(), /pick an Account/);
  d.getRange(6, 5).setValue('Transfer'); d.getRange(6, 9).setValue('Bank → HDFC'); edit(6, 4);
  assert.match(toasts().pop(), /needs a "To Account"/);
});

test('no warning for a complete row or an empty amount', () => {
  const { d, edit, toasts } = setup();
  d.getRange(7, 4, 1, 3).setValues([[50, 'Expense', 'Debt → Car EMI']]); d.getRange(7, 9).setValue('Bank → HDFC');
  const before = toasts().length; edit(7, 4);
  assert.equal(toasts().length, before);
  edit(8, 6, 'Debt → Car EMI');
  assert.equal(toasts().length, before);
});
