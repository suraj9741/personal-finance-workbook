'use strict';
// Loads every src/**/*.gs file into ONE shared scope, exactly like Apps Script does,
// with the mocked Google services from gas-mock.js. Returns that scope.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGas } = require('./gas-mock');

const SRC = path.join(__dirname, '..', '..', 'src');
function gsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? gsFiles(path.join(dir, e.name)) : e.name.endsWith('.gs') ? [path.join(dir, e.name)] : []);
}

function loadProject() {
  const gas = createGas();
  const ctx = vm.createContext(Object.assign({ console }, gas.globals));
  const files = gsFiles(SRC).sort((a, b) => (a.includes('config') ? -1 : 0) - (b.includes('config') ? -1 : 0));
  for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: path.relative(SRC, f) });
  // `const`/`let` globals aren't properties of the context; expose them for tests.
  const g = name => vm.runInContext(name, ctx);
  return { ctx, gas, g, run: code => vm.runInContext(code, ctx) };
}

module.exports = { loadProject, gsFiles, SRC };
