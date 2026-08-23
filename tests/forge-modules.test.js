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
test('showOpenIssues ersetzt showPullRequests', () => {
  const result = transform([{ open_issues_count: 4 }, []], withDefaults({ repos: 'a/b' }));
  assert.equal(result.repos[0].openIssues, 4);
  assert.equal(result.showOpenIssues, true);
});

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

// --- Gitea auf demselben Kern -------------------------------------------

const gitea = require(path.join(ROOT, 'modules/gitea/backend.js'));
const giteaDef = gitea._definition;
const giteaConfig = (config) => ({ ...giteaDef.defaults, ...config });

test('Gitea braucht eine Adresse, sonst keine Anfragen', () => {
  assert.deepEqual(giteaDef.buildRequests(giteaConfig({ repos: 'a/b' })), []);
  assert.deepEqual(
    giteaDef.buildRequests(giteaConfig({ repos: 'a/b', instanceUrl: 'nicht-mal-eine-url' })),
    []
  );
});

test('Gitea baut seine Adressen aus der Instanz', () => {
  const requests = giteaDef.buildRequests(giteaConfig({
    repos: 'luis/spiegel',
    // Abschliessender Schrägstrich darf nicht zu einer doppelten Trennung führen.
    instanceUrl: 'https://git.zuhause.lan/',
    maxCommits: 2
  }));

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://git.zuhause.lan/api/v1/repos/luis/spiegel');
  assert.equal(requests[1].url, 'https://git.zuhause.lan/api/v1/repos/luis/spiegel/commits?limit=2');
});

// Gitea erwartet "token <wert>", GitHub "Bearer <wert>". Vertauscht ergibt
// das eine 401, deren Ursache man lange sucht.
test('Gitea benutzt die eigene Schreibweise für die Anmeldung', () => {
  const [request] = giteaDef.buildRequests(giteaConfig({
    repos: 'a/b',
    instanceUrl: 'https://git.example',
    token: 'geheim'
  }));

  assert.equal(request.headers.Authorization, 'token geheim');
});

test('Gitea liest die Sterne aus seinem eigenen Feld', () => {
  const result = giteaDef.transform(
    [{ stars_count: 12, open_issues_count: 1 }, []],
    giteaConfig({ repos: 'a/b', instanceUrl: 'https://git.example' })
  );

  assert.equal(result.repos[0].stars, 12, 'Gitea nennt das Feld stars_count, nicht stargazers_count');
  assert.equal(result.provider, 'gitea');
});

test('selbstsignierte Zertifikate werden nur bei Gitea und nur auf Wunsch erlaubt', () => {
  const strict = giteaDef.buildRequests(giteaConfig({
    repos: 'a/b', instanceUrl: 'https://git.example'
  }));
  assert.equal(strict[0].allowInsecureTls, false);

  const lax = giteaDef.buildRequests(giteaConfig({
    repos: 'a/b', instanceUrl: 'https://git.example', allowInsecureTls: true
  }));
  assert.equal(lax[0].allowInsecureTls, true);

  // GitHub ist öffentlich - dort gibt es keinen Grund dafür.
  const gh = buildRequests(withDefaults({ repos: 'a/b' }));
  assert.ok(!gh[0].allowInsecureTls);
});

// Beide Module teilen sich den Kern. Wenn jemand den kaputt macht, sollen
// nicht zwei Tests separat rot werden, sondern dieser hier.
test('beide Anbieter liefern dieselbe Form', () => {
  const fromGithub = transform([{ stargazers_count: 1 }, []], withDefaults({ repos: 'a/b' }));
  const fromGitea = giteaDef.transform(
    [{ stars_count: 1 }, []],
    giteaConfig({ repos: 'a/b', instanceUrl: 'https://git.example' })
  );

  assert.deepEqual(Object.keys(fromGithub).sort(), Object.keys(fromGitea).sort());
  assert.deepEqual(Object.keys(fromGithub.repos[0]).sort(), Object.keys(fromGitea.repos[0]).sort());
});
