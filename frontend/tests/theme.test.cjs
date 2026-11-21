const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function bootstrap(saved, dark, denied = false) {
  const file = require('node:path').join(__dirname, '../src/theme.ts');
  assert.ok(fs.existsSync(file), 'Theme bootstrap must exist before the first paint');
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { exports: module.exports, module });
  const document = { documentElement: { dataset: {}, style: {} } };
  vm.runInNewContext(module.exports.themeBootstrap, {
    document,
    localStorage: { getItem() { if (denied) throw new Error('Storage denied'); return saved; } },
    window: { matchMedia: () => ({ matches: dark }) },
  });
  return document.documentElement.dataset;
}
test('follows the system on first visit', () => {
  assert.equal(bootstrap(null, true).theme, 'dark');
  assert.equal(bootstrap(null, false).theme, 'light');
});
test('saved explicit appearance overrides the system', () => {
  assert.equal(bootstrap('light', true).theme, 'light');
  assert.equal(bootstrap('dark', false).theme, 'dark');
});
test('invalid and inaccessible storage fall back to the system', () => {
  assert.equal(bootstrap('invalid', true).theme, 'dark');
  assert.equal(bootstrap(null, true, true).theme, 'dark');
});
