const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
const UntisModule = require(path.join(ROOT, 'modules/untis/index.js'));

function categoryFor(subject, extra = {}) {
  const module = new UntisModule({ language: 'de' });
  // getLessonInfo greift auf die Nachschlagetabellen zu; für den Test genügt
  // ein Objekt, das den Fachnamen direkt mitbringt.
  module.getLessonInfo = () => ({ subject, room: '', teacher: '' });
  return module.getLessonCategory({ ...extra });
}

test('Zustände gehen vor Fachzuordnung', () => {
  assert.equal(categoryFor('Mathematik', { code: 'cancelled' }), 'cancelled');
  assert.equal(categoryFor('Mathematik', { cellState: 'CANCEL' }), 'cancelled');
  assert.equal(categoryFor('Mathematik', { code: 'irregular' }), 'substitution');
  assert.equal(categoryFor('Mathematik', { cellState: 'SUBSTITUTION' }), 'substitution');
  assert.equal(categoryFor('Mathematik', { lstext: 'Raumänderung' }), 'substitution');
});

test('Fächer werden ihren Kategorien zugeordnet', () => {
  assert.equal(categoryFor('AM'), 'math');
  assert.equal(categoryFor('Mathematik'), 'math');
  assert.equal(categoryFor('INF'), 'it');
  assert.equal(categoryFor('SYEN'), 'it');
  assert.equal(categoryFor('HWE'), 'electronics');
  assert.equal(categoryFor('Physik'), 'science');
  assert.equal(categoryFor('D'), 'lang-de');
  assert.equal(categoryFor('E'), 'lang-en');
  assert.equal(categoryFor('Sport'), 'sports');
  assert.equal(categoryFor('Labor'), 'lab');
});

test('ein unbekanntes Fach bekommt die Standardkategorie', () => {
  assert.equal(categoryFor('Zeichnen und Gestalten XYZ'), 'default');
});

// Der eigentliche Zweck der Umstellung: vorher lieferte getLessonColor()
// Hex-Werte, die als Inline-Style gesetzt wurden. Inline-Styles schlagen
// jede Stylesheet-Regel - kein Theme konnte die Stundentafel umfärben.
test('das Modul setzt keine Farben mehr als Inline-Style', () => {
  const source = fs.readFileSync(path.join(ROOT, 'modules/untis/index.js'), 'utf8');

  assert.doesNotMatch(source, /getLessonColor/, 'getLessonColor ist zurück');
  assert.doesNotMatch(
    source,
    /style="[^"]*(background-color|border-left|color):\s*\$\{/,
    'Farbe wird wieder als Inline-Style gesetzt'
  );
  assert.match(source, /untis-cat-\$\{category\}/, 'Kategorie-Klasse fehlt');
});

test('jede Kategorie hat eine Regel im Stylesheet', () => {
  const source = fs.readFileSync(path.join(ROOT, 'modules/untis/index.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'modules/untis/styles.css'), 'utf8');

  const categories = [...source.matchAll(/return '([a-z-]+)';/g)]
    .map(match => match[1])
    .filter(name => name !== 'week' && name !== 'day');

  assert.ok(categories.length >= 14, `nur ${categories.length} Kategorien gefunden`);

  for (const category of new Set(categories)) {
    assert.match(
      css,
      new RegExp(`\\.untis-cat-${category}\\b`),
      `Kategorie "${category}" hat keine Regel in styles.css und bliebe farblos`
    );
  }
});
