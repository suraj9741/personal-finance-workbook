'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./load');

const P = loadProject();
const g = P.g;

test('colL_ converts column numbers to letters', () => {
  const colL_ = g('colL_');
  assert.equal(colL_(1), 'A');
  assert.equal(colL_(26), 'Z');
  assert.equal(colL_(27), 'AA');
  assert.equal(colL_(32), 'AF');
  assert.equal(colL_(702), 'ZZ');
  assert.equal(colL_(703), 'AAA');
});

test('qs_ doubles quotes for use inside formulas', () => {
  assert.equal(g('qs_')('He said "hi"'), 'He said ""hi""');
  assert.equal(g('qs_')(42), '42');
});

test('flat_ flattens {Parent:[Subs]} and drops duplicate pairs, keeping order', () => {
  const out = g('flat_')({ A: ['x', 'y', 'x'], B: ['x'] });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), [['A', 'x'], ['A', 'y'], ['B', 'x']]);
});

test('flatAccounts_ produces [PayType, Account, 0] rows', () => {
  const out = g('flatAccounts_')({ Bank: ['HDFC'], Cash: ['Cash'] });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), [['Bank', 'HDFC', 0], ['Cash', 'Cash', 0]]);
});

test('derived ranges follow CONFIG row limits', () => {
  const CONFIG = g('CONFIG'), R = g('R');
  assert.equal(g('DROWS'), CONFIG.MAX_TRANSACTION_ROWS + 1);
  assert.equal(g('CROWS'), CONFIG.MAX_CATEGORY_ROWS + 1);
  assert.equal(R.AMT, `Data!$D$2:$D$${g('DROWS')}`);
  assert.equal(R.cO, `Config!$Q$2:$Q$${g('CROWS')}`);
  for (const [k, v] of Object.entries(R)) assert.match(v, /^(Data|Config)!\$[A-Z]+\$2:\$[A-Z]+\$\d+$/, k);
  assert.ok(g('CUR').startsWith(CONFIG.CURRENCY));
});

test('classBalance_ adds income and transfers in, subtracts expenses and transfers out', () => {
  const f = g('classBalance_')('Bank');
  const R = g('R');
  assert.ok(f.startsWith('IFERROR('));
  assert.ok(f.includes(`SUMIFS(${R.cO},${R.cM},"Bank")`), 'opening balance');
  assert.ok(f.includes(`+SUMIFS(${R.AMT},${R.TYP},"Income",${R.JPT},"Bank")`), 'income in');
  assert.ok(f.includes(`+SUMIFS(${R.AMT},${R.TYP},"Transfer",${R.MPT},"Bank")`), 'transfer in (to side)');
  assert.ok(f.includes(`-SUMIFS(${R.AMT},${R.TYP},"Expense",${R.JPT},"Bank")`), 'expense out');
  assert.ok(f.includes(`-SUMIFS(${R.AMT},${R.TYP},"Transfer",${R.JPT},"Bank")`), 'transfer out (from side)');
});

test('navDefs_ has Home, Annual, 12 months, Accounts, Data, Config', () => {
  const n = g('navDefs_')();
  assert.equal(n.length, 17);
  const months = n.filter(x => x.group === 'month').map(x => x.target);
  assert.equal(months.length, 12);
  assert.equal(months[0], 'Jan_' + g('CONFIG').YEAR);
  assert.equal(months[11], 'Dec_' + g('CONFIG').YEAR);
});

test('Log_ buffers messages and flushLogs_ writes them to _Logs', () => {
  P.run('LOGS = []');
  g('Log_')('INFO', 'hello');
  const ss = P.gas.globals.SpreadsheetApp.create('logs');
  g('flushLogs_')(ss);
  const sh = ss.getSheetByName('_Logs');
  assert.ok(sh);
  assert.equal(sh.getRange('C2').getValue(), 'hello');
  assert.equal(P.run('LOGS.length'), 0);
});
