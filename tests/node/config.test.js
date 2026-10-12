'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./load');

const g = loadProject().g;
const CONFIG = g('CONFIG');

test('CONFIG values are sane', () => {
  assert.ok(Number.isInteger(CONFIG.YEAR) && CONFIG.YEAR >= 2020 && CONFIG.YEAR <= 2100);
  assert.ok(CONFIG.WORKBOOK_NAME.includes(String(CONFIG.YEAR)), 'workbook name should mention the year');
  assert.match(CONFIG.DRIVE_FOLDER_ID, /^[\w-]{20,}$/, 'Drive folder ID looks wrong');
  assert.ok(['DELETE', 'BACKUP', 'SKIP'].includes(CONFIG.REBUILD_MODE));
  assert.deepEqual([...CONFIG.MONTHS], ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  assert.ok(CONFIG.MAX_TRANSACTION_ROWS >= 1000);
});

test('monthly-sheet panels do not overlap', () => {
  const L = g('LAYOUT');
  const panels = [
    ['Expense', L.EXPENSE_COL, 6], ['Income', L.INCOME_COL, 6], ['Transfer', L.TRANSFER_COL, 3],
    ['Accounts+Totals', L.ACCOUNTS_COL, 12], ['Transactions', L.TXN_COL, 6],
  ].map(([n, s, w]) => ({ n, s, e: s + w - 1 })).sort((a, b) => a.s - b.s);
  for (let i = 1; i < panels.length; i++)
    assert.ok(panels[i].s > panels[i - 1].e, `${panels[i - 1].n} overlaps ${panels[i].n}`);
});

const SEP = g('STYLE').ARROW;
for (const type of ['EXPENSE', 'INCOME', 'TRANSFER']) {
  test(`default ${type.toLowerCase()} categories are clean`, () => {
    const dict = g('DEFAULT_CATEGORIES')[type];
    for (const [parent, subs] of Object.entries(dict)) {
      assert.ok(subs.length > 0, `${parent} has no subs`);
      assert.equal(new Set(subs).size, subs.length, `${parent} repeats a sub`);
      for (const s of [parent, ...subs]) {
        assert.equal(s, s.trim(), `"${s}" has extra spaces`);
        assert.ok(!s.includes(SEP), `"${s}" contains ${SEP}, which splits Parent/Sub`);
      }
    }
  });
}

test('default accounts: unique per pay type, matching the seed list', () => {
  const A = g('DEFAULT_ACCOUNTS');
  for (const [t, list] of Object.entries(A)) assert.equal(new Set(list).size, list.length, `${t} repeats an account`);
  const flat = g('flatAccounts_')(A).map(r => r[0] + '|' + r[1]).sort();
  const seed = g('SEED').PAY.map(r => r[0] + '|' + r[1]).sort();
  assert.deepEqual(flat, seed);
  assert.deepEqual([...g('ACCOUNT_SECTIONS').map(s => s[1])].sort(), [...Object.keys(A)].sort());
});
