const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ThemeManager = require(path.join(ROOT, 'src/main/themeManager.js'));

// Kommentare erklaeren oft genau das, wonach ein Test sucht - vor der
// Pruefung also entfernen.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function themeCss(theme) {
  return stripComments(fs.readFileSync(path.join(ROOT, 'themes', theme.href), 'utf8'));
}

const manager = new ThemeManager(path.join(ROOT, 'themes'));
const themes = manager.scanThemes();
const custom = themes.filter(theme => theme.id !== 'default');

test('das Standard-Theme ist immer dabei', () => {
  assert.equal(themes[0].id, 'default');
  assert.equal(themes[0].href, null, 'Standard darf kein Stylesheet laden');
});

test('alle sechs Themes werden gefunden', () => {
  const ids = custom.map(theme => theme.id).sort();
  assert.deepEqual(ids, ['cyberpunk', 'glass', 'minimal', 'nature', 'newspaper', 'oled-black']);
});

test('jedes Theme hat Metadaten und eine vorhandene Datei', () => {
  for (const theme of custom) {
    assert.ok(theme.name, `${theme.id}: kein Name`);
    assert.ok(theme.description, `${theme.id}: keine Beschreibung`);
    assert.ok(['dark', 'light'].includes(theme.mode), `${theme.id}: ungültiger Modus`);
    assert.ok(
      fs.existsSync(path.join(ROOT, 'themes', theme.href)),
      `${theme.id}: ${theme.href} fehlt`
    );
  }
});

// Ein Token-Set, das nur mit dunklen Oberflächen umgehen kann, fällt erst
// auf, wenn jemand ein helles Theme baut. Deshalb ist eines fest dabei.
test('es gibt mindestens ein helles Theme als Gegenprobe', () => {
  assert.ok(
    custom.some(theme => theme.mode === 'light'),
    'ohne helles Theme bleibt unbemerkt, wenn ein Modul Weiß hartcodiert'
  );
});

test('kein Theme braucht !important', () => {
  for (const theme of custom) {
    const hits = themeCss(theme).match(/!important/g) || [];
    assert.equal(
      hits.length, 0,
      `${theme.id}: ${hits.length} mal !important. Seit Modul-CSS in @layer module liegt, `
      + 'gewinnt @layer theme unbedingt - !important ist ein Zeichen dafür, dass die Layer nicht greifen.'
    );
  }
});

test('jedes Theme liegt in @layer theme', () => {
  for (const theme of custom) {
    assert.match(
      themeCss(theme), /@layer theme\s*\{/,
      `${theme.id}: ohne @layer theme steht das Theme ausserhalb der Kaskade`
    );
  }
});

test('die Layer-Reihenfolge steht im zuerst geladenen Stylesheet', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'src/renderer/styles/tokens.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');

  assert.match(tokens, /@layer\s+base,\s*module,\s*theme,\s*overrides\s*;/);

  const links = [...indexHtml.matchAll(/<link[^>]+href="styles\/([^"]+)"/g)].map(m => m[1]);
  assert.equal(
    links[0], 'tokens.css',
    'tokens.css muss zuerst geladen werden - die @layer-Reihenfolge gilt ab ihrer ersten Nennung'
  );
});

test('Modul-CSS wird beim Injizieren in @layer module verpackt', () => {
  const loader = fs.readFileSync(path.join(ROOT, 'src/renderer/moduleLoader.js'), 'utf8');
  assert.match(
    loader, /@layer module \{/,
    'ohne diese Verpackung gewinnt Modul-CSS wieder gegen das Theme'
  );
});

test('die Schriften werden lokal geladen, nicht von Google', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  const fontsCss = stripComments(fs.readFileSync(path.join(ROOT, 'src/renderer/styles/fonts.css'), 'utf8'));

  assert.doesNotMatch(indexHtml, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(fontsCss, /https?:\/\//, 'fonts.css verweist noch nach außen');

  for (const theme of custom) {
    assert.doesNotMatch(
      themeCss(theme), /@import\s+url\(/,
      `${theme.id}: ein @import ist ein render-blockierender Roundtrip beim Booten`
    );
  }

  const files = fs.readdirSync(path.join(ROOT, 'src/renderer/assets/fonts'));
  assert.ok(files.filter(f => f.endsWith('.woff2')).length >= 10, 'Schriftdateien fehlen');
});

// Ein Theme, das nur einen Teil der Tokens belegt, erbt den Rest - das ist
// gewollt. Belegt es aber eine Farbe, die es gar nicht gibt, ist das ein
// Tippfehler, der stillschweigend wirkungslos bleibt.
test('Themes belegen nur Tokens, die es auch gibt', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'src/renderer/styles/tokens.css'), 'utf8');
  const known = new Set([...tokens.matchAll(/(--mm-[a-z0-9-]+)\s*:/g)].map(m => m[1]));

  for (const theme of custom) {
    const declared = [...themeCss(theme).matchAll(/^\s*(--mm-[a-z0-9-]+)\s*:/gm)].map(m => m[1]);

    for (const name of declared) {
      assert.ok(known.has(name), `${theme.id}: "${name}" ist in tokens.css nicht definiert`);
    }
  }
});
