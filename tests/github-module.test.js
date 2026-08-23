const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const github = require(path.join(ROOT, 'modules/github/backend.js'));

const { defaults, buildRequests, transform, testConnection } = github._definition;
const withDefaults = (config) => ({ ...defaults, ...config });

test('ohne Repositories werden keine Anfragen gebaut', () => {
  assert.deepEqual(buildRequests(withDefaults({ repos: '' })), []);
  assert.deepEqual(buildRequests(withDefaults({ repos: '   ' })), []);
});

// Ein Tippfehler in der Eingabe darf keine sinnlose Anfrage nach draussen
// ausloesen - und schon gar keinen fremden Pfad ansprechen.
test('unbrauchbare Einträge werden verworfen', () => {
  const requests = buildRequests(withDefaults({
    repos: 'gueltig/repo, kaputt, /leer, noch/eins, ../../etc/passwd'
  }));

  const urls = requests.map(r => r.url);
  assert.equal(requests.length, 4, 'genau zwei gültige Einträge, je zwei Anfragen');
  assert.ok(urls.some(u => u.endsWith('/repos/gueltig/repo')));
  assert.ok(urls.some(u => u.endsWith('/repos/noch/eins')));
  assert.ok(!urls.some(u => u.includes('passwd')));
});

test('je Repository werden Beschreibung und Commits abgefragt', () => {
  const requests = buildRequests(withDefaults({ repos: 'a/b', maxCommits: 5 }));

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/repos\/a\/b$/);
  assert.match(requests[1].url, /\/repos\/a\/b\/commits\?per_page=5$/);
});

test('maxCommits wird auf einen vernünftigen Bereich begrenzt', () => {
  const tooMany = buildRequests(withDefaults({ repos: 'a/b', maxCommits: 999 }));
  assert.match(tooMany[1].url, /per_page=10$/);

  const tooFew = buildRequests(withDefaults({ repos: 'a/b', maxCommits: 0 }));
  assert.match(tooFew[1].url, /per_page=1$/);
});

// GitHub antwortet ohne User-Agent mit 403 - ein Fehler, der ohne diesen Test
// erst beim ersten echten Abruf auffiele.
test('die Anfragen tragen die von GitHub geforderten Köpfe', () => {
  const [request] = buildRequests(withDefaults({ repos: 'a/b' }));

  assert.ok(request.headers['User-Agent'], 'ohne User-Agent antwortet GitHub mit 403');
  assert.match(request.headers.Accept, /vnd\.github/);
  assert.equal(request.headers.Authorization, undefined, 'ohne Token kein Authorization-Kopf');
});

test('ein Token wird als Bearer mitgeschickt', () => {
  const [request] = buildRequests(withDefaults({ repos: 'a/b', token: 'geheim' }));
  assert.equal(request.headers.Authorization, 'Bearer geheim');
});

test('transform bringt die Antworten in eine anzeigbare Form', () => {
  const responses = [
    { stargazers_count: 1234, open_issues_count: 7, full_name: 'a/b' },
    [
      {
        sha: 'abcdef1234567890',
        commit: {
          message: 'Erste Zeile\n\nEin langer Rumpf, der nicht angezeigt werden soll.',
          author: { name: 'Luis', date: '2026-08-23T10:00:00Z' }
        }
      }
    ]
  ];

  const result = transform(responses, withDefaults({ repos: 'a/b' }));
  const repo = result.repos[0];

  assert.equal(repo.name, 'a/b');
  assert.equal(repo.shortName, 'b');
  assert.equal(repo.stars, 1234);
  assert.equal(repo.commits[0].message, 'Erste Zeile', 'der Rumpf gehört nicht in die Anzeige');
  assert.equal(repo.commits[0].author, 'Luis');
  assert.equal(repo.commits[0].sha, 'abcdef1');
});

test('transform verkraftet unvollständige Antworten', () => {
  const result = transform([{}, []], withDefaults({ repos: 'a/b' }));
  const repo = result.repos[0];

  assert.equal(repo.stars, null);
  assert.deepEqual(repo.commits, []);
});

test('mehrere Repositories bleiben in der richtigen Reihenfolge', () => {
  const responses = [
    { stargazers_count: 1 }, [],
    { stargazers_count: 2 }, []
  ];

  const result = transform(responses, withDefaults({ repos: 'erst/eins, dann/zwei' }));

  assert.equal(result.repos[0].name, 'erst/eins');
  assert.equal(result.repos[0].stars, 1);
  assert.equal(result.repos[1].name, 'dann/zwei');
  assert.equal(result.repos[1].stars, 2);
});

test('der Verbindungstest meldet fehlende Repositories statt zu werfen', async () => {
  const result = await testConnection(withDefaults({ repos: '' }), async () => {
    throw new Error('darf gar nicht erst angefragt werden');
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Repositories/);
});

test('der Verbindungstest meldet, ob ein Token benutzt wird', async () => {
  const request = async () => ({ data: { full_name: 'a/b' } });

  const ohne = await testConnection(withDefaults({ repos: 'a/b' }), request);
  assert.equal(ohne.ok, true);
  assert.equal(ohne.authenticated, false, 'ohne Token ist das Kontingent der häufigste Stolperstein');

  const mit = await testConnection(withDefaults({ repos: 'a/b', token: 'x' }), request);
  assert.equal(mit.authenticated, true);
});
