const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { matchesTopic } = require(path.join(ROOT, 'src/main/wsHub.js'));

const SOURCE_DIRS = ['src', 'modules', 'scripts'];

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap(dir => collectFiles(path.join(ROOT, dir)));

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const emitted = new Set();
const subscribed = new Map();

for (const file of files) {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const relative = path.relative(ROOT, file);

  // Gesendet wird über bus.emit(), publish() oder mmBus.publish().
  for (const match of source.matchAll(/(?:bus\.emit|publish|broadcast)\(\s*'([a-z0-9:_-]+)'/gi)) {
    emitted.add(match[1]);
  }

  // Abonniert wird über bus.on(), mmBus.on(), subscribe() oder die
  // topics-Liste einer WebSocket-Nachricht.
  for (const match of source.matchAll(/(?:bus\.on|mmBus\.on|\.subscribe)\(\s*'([a-z0-9:*_-]+)'/gi)) {
    if (!subscribed.has(match[1])) subscribed.set(match[1], relative);
  }

  for (const match of source.matchAll(/topics:\s*\[([^\]]*)\]/g)) {
    for (const topic of match[1].matchAll(/'([a-z0-9:*_-]+)'/gi)) {
      if (!subscribed.has(topic[1])) subscribed.set(topic[1], relative);
    }
  }
}

test('es werden überhaupt Themen gesendet und abonniert', () => {
  assert.ok(emitted.size >= 4, `nur ${emitted.size} gesendete Themen gefunden`);
  assert.ok(subscribed.size >= 4, `nur ${subscribed.size} Abos gefunden`);
});

// Der Fehler, den die Startprobe aufgedeckt hat: abonniert war 'config', das
// Ereignis heisst aber 'config:changed'. Ein Muster ohne ':*' trifft nur den
// exakten Namen - also kam nie etwas an. Weder in der Web-Oberfläche noch in
// der Live-Ansicht, und auffallen konnte es nicht, weil beide beim Laden ja
// trotzdem Daten holen.
test('jedes Abo passt auf mindestens ein gesendetes Thema', () => {
  const orphans = [];

  for (const [pattern, file] of subscribed) {
    if (pattern === '*') continue;

    const matches = [...emitted].some(topic => matchesTopic(pattern, topic));
    if (!matches) {
      orphans.push(`  "${pattern}" in ${file}`);
    }
  }

  assert.deepEqual(
    orphans, [],
    'Diese Abos treffen kein einziges gesendetes Thema:\n' + orphans.join('\n')
      + '\n\nGesendet wird: ' + [...emitted].sort().join(', ')
  );
});
