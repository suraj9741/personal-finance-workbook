'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProject } = require('./load');

test('uses the open workbook when its name matches', () => {
  const P = loadProject();
  P.gas.active.name = P.g('CONFIG').WORKBOOK_NAME;
  assert.equal(P.g('getOrCreateSpreadsheet_')(), P.gas.active.self);
  assert.equal(P.gas.state.created.length, 0);
});

test('a wrong Drive folder ID stops with an error', () => {
  const P = loadProject();
  P.run('CONFIG.DRIVE_FOLDER_ID = "bad"');
  assert.throws(() => P.g('getOrCreateSpreadsheet_')(), /No item with the given ID/);
  assert.equal(P.gas.state.created.length, 0, 'no stray workbook created');
});

test('prepareSheet_: new sheet, BACKUP, SKIP and DELETE modes', () => {
  const P = loadProject();
  const ss = P.gas.globals.SpreadsheetApp.create('t');
  P.ctx.__ss = ss;
  const first = P.run('prepareSheet_(__ss, "X")');
  first.getRange('A1').setValue('old');
  const again = P.run('prepareSheet_(__ss, "X")');
  assert.equal(again, first, 'BACKUP rebuilds the same sheet (formulas elsewhere keep pointing at it)');
  assert.equal(again.getRange('A1').getValue(), '', 'and clears it');
  const bak = ss.getSheets().find(s => s.getName().startsWith('X_Backup_'));
  assert.ok(bak && bak.isSheetHidden());
  assert.equal(bak.getRange('A1').getValue(), 'old');
  assert.equal(P.run('CONFIG.REBUILD_MODE = "SKIP"; const r = prepareSheet_(__ss, "X"); CONFIG.REBUILD_MODE = "BACKUP"; r'), null);
  const fresh = P.run('CONFIG.REBUILD_MODE = "DELETE"; const r2 = prepareSheet_(__ss, "X"); CONFIG.REBUILD_MODE = "BACKUP"; r2');
  assert.notEqual(fresh, first);
});
