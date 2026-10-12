'use strict';
// In-memory stand-ins for the Google Apps Script services this project uses.
// Values and formulas are stored, but formulas are NOT calculated: Node tests check
// what the script writes; the in-sheet suite (src/tests/Tests.gs) checks calculated results.

// Anything not modelled below returns a "chain" object: every method call returns
// the chain again, so builder-style calls (setFontWeight(...).setBackground(...)) work.
function chain(extra = {}) {
  const p = new Proxy(function () {}, {
    get(_, k) {
      if (k in extra) return extra[k];
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;
      return () => p;
    },
    apply() { return p; },
  });
  return p;
}
function wrap(target) {
  return new Proxy(target, {
    get(t, k, r) {
      if (k in t) return Reflect.get(t, k, r);
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') return undefined;
      return () => r;               // unknown method: chainable no-op
    },
  });
}

const colNum = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colL = c => { let s = ''; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; };

function parseA1(a1, maxRows) {
  const clean = a1.replace(/\$/g, '');
  const [a, b] = clean.split(':');
  const cell = s => { const m = /^([A-Z]+)(\d*)$/.exec(s); if (!m) throw new Error('Bad A1: ' + a1); return { c: colNum(m[1]), r: m[2] ? +m[2] : null }; };
  const s = cell(a), e = b ? cell(b) : s;
  const r1 = s.r || 1, r2 = e.r || maxRows;
  return { r: r1, c: s.c, nr: r2 - r1 + 1, nc: e.c - s.c + 1 };
}

let NEXT_ID = 1;
class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.id = NEXT_ID++; this.cells = new Map(); this.hidden = false;
    this.rules = []; this.validations = []; this.frozen = 0; }
  key(r, c) { return r + ',' + c; }
  cell(r, c) { return this.cells.get(this.key(r, c)) || { v: '', f: '' }; }
  put(r, c, patch) { const k = this.key(r, c); this.cells.set(k, Object.assign({ v: '', f: '' }, this.cells.get(k), patch)); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this.self; }
  getSheetId() { return this.id; }
  getParent() { return this.ss.self; }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getMaxColumns() { return Math.max(40, this.getLastColumn()); }
  getLastRow() { let m = 0; for (const [k, c] of this.cells) if (c.v !== '' || c.f) m = Math.max(m, +k.split(',')[0]); return m; }
  getLastColumn() { let m = 0; for (const [k, c] of this.cells) if (c.v !== '' || c.f) m = Math.max(m, +k.split(',')[1]); return m; }
  getRange(a, b, nr, nc) {
    if (typeof a === 'string') { const p = parseA1(a, this.getMaxRows()); return new Range(this, p.r, p.c, p.nr, p.nc).self; }
    return new Range(this, a, b, nr || 1, nc || 1).self;
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  clear() { this.cells.clear(); return this.self; }
  copyTo(ss) { const s = ss.self._insert('Copy of ' + this.name); for (const [k, v] of this.cells) s.cells.set(k, Object.assign({}, v));
    s.hidden = this.hidden; return s.self; }
  hideSheet() { this.hidden = true; return this.self; }
  showSheet() { this.hidden = false; return this.self; }
  isSheetHidden() { return this.hidden; }
  getCharts() { return []; }
  getFilter() { return null; }
  getConditionalFormatRules() { return this.rules.slice(); }
  setConditionalFormatRules(r) { this.rules = r.slice(); return this.self; }
  clearConditionalFormatRules() { this.rules = []; return this.self; }
  getFrozenRows() { return this.frozen; }
  setFrozenRows(n) { this.frozen = n; return this.self; }
  getFrozenColumns() { return 0; }
  newChart() { return chain({ build: () => ({}) }); }
  deleteRows() { return this.self; }
}
class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); this.self = wrap(this); }
  getSheet() { return this.sheet.self; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getA1Notation() { const a = colL(this.c) + this.r; return this.nr === 1 && this.nc === 1 ? a : a + ':' + colL(this.c + this.nc - 1) + (this.r + this.nr - 1); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.cell(this.r + i, this.c + j).v); out.push(row); } return out; }
  getDisplayValues() { return this.getValues().map(r => r.map(String)); }
  getValue() { return this.sheet.cell(this.r, this.c).v; }
  getFormula() { return this.sheet.cell(this.r, this.c).f; }
  setValues(v) {
    if (v.length !== this.nr || v.some(row => row.length !== this.nc))
      throw new Error(`setValues: data is ${v.length}x${v[0] && v[0].length}, range ${this.getA1Notation()} is ${this.nr}x${this.nc}`);
    this.each((r, c, i, j) => this.sheet.put(r, c, { v: v[i][j], f: '' })); return this.self;
  }
  setValue(v) { this.each((r, c) => this.sheet.put(r, c, { v, f: '' })); return this.self; }
  setFormula(f) { this.sheet.put(this.r, this.c, { f, v: '' }); return this.self; }
  setFormulas(fs) { this.each((r, c, i, j) => this.sheet.put(r, c, { f: fs[i][j], v: '' })); return this.self; }
  clearContent() { this.each((r, c) => this.sheet.put(r, c, { v: '', f: '' })); return this.self; }
  setDataValidation(rule) { this.sheet.validations.push({ r: this.r, c: this.c, nr: this.nr, nc: this.nc, rule }); return this.self; }
  clearDataValidations() { return this.setDataValidation(null); }
  getDataValidation() {   // last rule written over this cell wins
    for (let i = this.sheet.validations.length - 1; i >= 0; i--) {
      const v = this.sheet.validations[i];
      if (this.r >= v.r && this.r < v.r + v.nr && this.c >= v.c && this.c < v.c + v.nc) return v.rule;
    }
    return null;
  }
}
// Sheet objects are wrapped once and reused, so identity checks (===) work.
function makeSheet(ss, name) { const s = new Sheet(ss, name); s.self = wrap(s); return s; }

class Spreadsheet {
  constructor(name) { this.name = name; this.id = 'ss' + NEXT_ID++; this.sheets = [makeSheet(this, 'Sheet1')]; this.named = {}; this.toasts = []; this.active = null; this.self = wrap(this); }
  _insert(name) { if (this.sheets.some(s => s.name === name)) throw new Error('Sheet exists: ' + name); const s = makeSheet(this, name); this.sheets.push(s); return s; }
  _find(sheet) { return this.sheets.find(s => s.self === sheet || s === sheet); }
  getName() { return this.name; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets.map(s => s.self); }
  getSheetByName(n) { const s = this.sheets.find(x => x.name === n); return s ? s.self : null; }
  insertSheet(n) { return this._insert(n).self; }
  deleteSheet(sh) { this.sheets = this.sheets.filter(s => s.self !== sh); }
  setActiveSheet(sh) { this.active = this._find(sh); return sh; }
  moveActiveSheet(pos) { const s = this.active; this.sheets = this.sheets.filter(x => x !== s); this.sheets.splice(pos - 1, 0, s); }
  getRange(a1) { const [sn, ref] = a1.includes('!') ? a1.split('!') : [this.sheets[0].name, a1]; return this.getSheetByName(sn.replace(/'/g, '')).getRange(ref); }
  getRangeByName(n) { return this.named[n] || null; }
  setNamedRange(n, r) { this.named[n] = r; }
  removeNamedRange(n) { delete this.named[n]; }
  toast(msg, title) { this.toasts.push({ msg, title }); }
}

function dvBuilder() {
  const rule = { type: null, args: [] };
  const b = chain({
    requireValueInRange: (rng) => { rule.type = 'VALUE_IN_RANGE'; rule.args = [rng]; return b; },
    requireValueInList: (list) => { rule.type = 'VALUE_IN_LIST'; rule.args = [list]; return b; },
    requireDate: () => { rule.type = 'DATE'; return b; },
    build: () => ({ getCriteriaType: () => rule.type, getCriteriaValues: () => rule.args }),
  });
  return b;
}

// Builds a fresh set of globals. `active` is the spreadsheet getActive() returns.
function createGas() {
  const state = { created: [], triggers: [], logs: [], trashed: [] };
  const active = new Spreadsheet('Host workbook');
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => (state.active ? state.active.self : null),   // null = standalone script
    getActive: () => (state.active ? state.active.self : null),
    create: (name) => { const s = new Spreadsheet(name); state.created.push(s); return s.self; },
    open: (f) => f._ss.self,
    openById: (id) => { const s = state.created.find(x => x.getId() === id); if (!s) throw new Error('Spreadsheet not found: ' + id); return s.self; },
    flush: () => {},
    newDataValidation: dvBuilder,
    newConditionalFormatRule: () => chain({ build: () => ({}) }),
    BorderStyle: new Proxy({}, { get: (_, k) => k }),
    getUi: () => chain({ alert: () => 'YES', ButtonSet: {}, Button: { YES: 'YES' } }),
  };
  state.active = active;
  const files = new Map();
  const DriveApp = {
    getFolderById: (id) => { if (!/^[\w-]{20,}$/.test(id)) throw new Error('No item with the given ID could be found: ' + id);
      return chain({ getFilesByName: () => ({ hasNext: () => false }), addFile: () => {} }); },
    getFileById: (id) => chain({ setTrashed: (t) => { if (t) state.trashed.push(id); }, makeCopy: () => chain({ getId: () => 'copy' }) }),
    getRootFolder: () => chain(),
  };
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.slice(),
    deleteTrigger: (t) => { state.triggers = state.triggers.filter(x => x !== t); },
    newTrigger: (fn) => chain({ create: () => { const t = { getHandlerFunction: () => fn }; state.triggers.push(t); return t; } }),
  };
  const Utilities = {
    formatDate: (d, tz, fmt) => d.toISOString().replace(/[-:T]/g, '').slice(0, 15),
    sleep: () => {},
  };
  const props = new Map();
  state.props = props;
  const store = {
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => { props.set(k, String(v)); return store; },
    deleteProperty: (k) => { props.delete(k); return store; },
  };
  const PropertiesService = { getUserProperties: () => store, getScriptProperties: () => store };
  return {
    state, active,
    globals: {
      PropertiesService,
      SpreadsheetApp, DriveApp, ScriptApp, Utilities,
      Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
      Logger: { log: (m) => state.logs.push(m) },
      HtmlService: { createHtmlOutput: (h) => chain({ getContent: () => h }) },
    },
  };
}

module.exports = { createGas, Spreadsheet, parseA1, colL };
