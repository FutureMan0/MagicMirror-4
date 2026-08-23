const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { html, escapeHtml } = require(path.join(ROOT, 'src/renderer/html.js'));

test('escapt die Zeichen, mit denen man aus Markup ausbricht', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
});

test('das Template-Tag escapt jede Interpolation', () => {
  const evil = '<script>alert(1)</script>';
  const out = html`<div>${evil}</div>`;
  assert.ok(!out.includes('<script>'), 'Markup ist durchgerutscht');
  assert.equal(out, '<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
});

// Anfuehrungszeichen sind der Grund, warum textContent-basiertes Escaping
// hier nicht reicht: in einem Attribut bricht man damit aus.
test('auch Attributwerte sind sicher', () => {
  const breakout = 'red" onload="alert(1)';
  const out = html`<div style="color: ${breakout}">x</div>`;
  assert.ok(!out.includes('onload="'), 'Ausbruch aus dem Attribut moeglich');
  assert.ok(out.includes('&quot;'));
});

test('html.raw setzt bewusst fertiges Markup ein', () => {
  assert.equal(html`<p>${html.raw('<b>fett</b>')}</p>`, '<p><b>fett</b></p>');
});

test('Arrays werden elementweise behandelt', () => {
  const items = ['a<b>', 'c&d'];
  const out = html`<ul>${items.map(item => html.raw(html`<li>${item}</li>`))}</ul>`;
  assert.equal(out, '<ul><li>a&lt;b&gt;</li><li>c&amp;d</li></ul>');
});

// Die Module bauen ihre Ausgabe aus Fremddaten. Wenn hier jemand das Tag
// wieder entfernt, faellt es sonst niemandem auf.
test('die Module setzen Fremddaten nur ueber das escapende Tag ein', () => {
  const untis = fs.readFileSync(path.join(ROOT, 'modules/untis/index.js'), 'utf8');

  for (const field of ['info.subject', 'info.room', 'info.teacher']) {
    const pattern = new RegExp(`\\$\\{${field.replace('.', '\\.')}\\}`, 'g');
    for (const match of untis.matchAll(pattern)) {
      // Den Anfang des umschliessenden Template-Literals suchen.
      const before = untis.slice(0, match.index);
      const start = Math.max(before.lastIndexOf('h`'), before.lastIndexOf('= `'), before.lastIndexOf('+= `'));
      assert.ok(
        before.slice(start).startsWith('h`'),
        `${field} wird ohne h\`\` eingesetzt - WebUntis-Daten landen ungeprueft in innerHTML`
      );
    }
  }

  const weather = fs.readFileSync(path.join(ROOT, 'modules/weather/index.js'), 'utf8');
  assert.match(
    weather,
    /alertBanner\.innerHTML = h`/,
    'Wetter-Warnungen kommen von OpenWeatherMap und muessen escapt werden'
  );

});

// Allgemeiner als die Einzelfaelle oben: kein Modul darf Fremddaten in ein
// ungetaggtes Template schreiben und daraus innerHTML machen. Wer statt
// dessen createElement und textContent benutzt - oder .src als Eigenschaft
// setzt statt als Attribut zu interpolieren - ist ohnehin sicher, weil dabei
// gar kein HTML geparst wird.
test('kein Modul baut innerHTML aus einem ungetaggten Template', () => {
  const modulesDir = path.join(ROOT, 'modules');

  for (const name of fs.readdirSync(modulesDir)) {
    const file = path.join(modulesDir, name, 'index.js');
    if (!fs.existsSync(file)) continue;

    const source = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // innerHTML = `…${…}…`  ohne vorangestelltes Tag.
    for (const match of source.matchAll(/innerHTML\s*=\s*(\w*)`([^`]*)`/g)) {
      const [, tag, body] = match;
      if (!body.includes('${')) continue;

      assert.ok(
        tag,
        `${name}: innerHTML wird aus einem ungetaggten Template mit Interpolation gebaut - `
        + 'fremde Daten koennen daraus Markup werden. h`` benutzen.'
      );
    }
  }
});

test('der Renderer erlaubt keine inline-Skripte mehr', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  // Gezielt das CSP-Meta greifen - das erste content="..." ist der Viewport.
  const csp = indexHtml.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]*)"/)[1];
  const scriptSrc = csp.split(';').find(part => part.trim().startsWith('script-src'));

  assert.ok(scriptSrc, 'script-src fehlt in der CSP');
  assert.ok(
    !scriptSrc.includes("'unsafe-inline'"),
    "script-src 'unsafe-inline' erlaubt wieder onerror-Handler aus fremden Daten"
  );
});
