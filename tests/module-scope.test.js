const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULES = path.join(ROOT, 'modules');

const names = fs.readdirSync(MODULES)
  .filter(name => fs.existsSync(path.join(MODULES, name, 'index.js')));

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/** Bindings, die eine Datei auf oberster Ebene deklariert. */
function topLevelBindings(source) {
  const bindings = [];
  for (const match of stripCommentsAndStrings(source).matchAll(
    /^(const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/gm
  )) {
    bindings.push({ kind: match[1], name: match[2] });
  }
  return bindings;
}

// Der Fehler, den die Startprobe aufgedeckt hat: klassische <script>-Dateien
// teilen sich EINEN globalen Scope. Zwei Module mit `const h` auf oberster
// Ebene liessen das zweite mit einem SyntaxError scheitern - sichtbar nur als
// "Modul konnte nicht geladen werden". Als ES-Modul ist das kein Problem
// mehr, unter file:// aber weiterhin die Rückfallebene.
test('kein Modul deklariert auf oberster Ebene ein const oder let doppelt', () => {
  const owners = new Map();
  const clashes = [];

  for (const name of names) {
    const source = fs.readFileSync(path.join(MODULES, name, 'index.js'), 'utf8');

    for (const binding of topLevelBindings(source)) {
      // var, class und function dürfen neu deklariert werden - const und let
      // werfen.
      if (binding.kind !== 'const' && binding.kind !== 'let') continue;

      const previous = owners.get(binding.name);
      if (previous && previous !== name) {
        clashes.push(`"${binding.name}" in ${previous} und ${name}`);
      }
      owners.set(binding.name, name);
    }
  }

  assert.deepEqual(
    clashes, [],
    'Unter file:// scheitert dabei das zweite Modul.\nBetroffen: ' + clashes.join(', ')
  );
});

test('jedes Modul registriert sich unter seinem Ordnernamen', () => {
  for (const name of names) {
    const source = fs.readFileSync(path.join(MODULES, name, 'index.js'), 'utf8');
    const pattern = new RegExp(
      `MagicMirrorModules(\\.${name.replace(/-/g, '\\-')}|\\['${name}'\\]|\\["${name}"\\])\\s*=`
    );
    assert.match(
      source, pattern,
      `${name} registriert sich nicht unter "${name}" - der Loader findet es dann nicht`
    );
  }
});

test('der Loader lädt bevorzugt als ES-Modul', () => {
  const loader = fs.readFileSync(path.join(ROOT, 'src/renderer/moduleLoader.js'), 'utf8');

  assert.match(loader, /await import\(url\)/, 'kein dynamisches import()');
  assert.match(
    loader, /protocol !== 'file:'/,
    'ohne Protokollprüfung schlägt import() unter file:// fehl'
  );
  assert.match(loader, /loadModuleScript/, 'die Rückfallebene fehlt');
});
