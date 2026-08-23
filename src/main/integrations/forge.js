const { defineHttpModule } = require('./httpModule');

/**
 * Gemeinsamer Kern für GitHub und Gitea.
 *
 * Beide zeigen dasselbe an - letzte Commits, offene Vorgänge, Sterne - und
 * unterscheiden sich nur in Kleinigkeiten: der Adresse, dem Namen des
 * Authorization-Kopfs, wie das Feld für Sterne heisst und wie die Anzahl der
 * Commits begrenzt wird.
 *
 * Zwei fast gleiche Module nebeneinander wären zwei Stellen, an denen
 * derselbe Fehler behoben werden muss. Deshalb ein Kern und zwei Adapter.
 */

/** Prüft Einträge der Form besitzer/name und verwirft alles andere. */
function parseRepos(value) {
  return String(value || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => /^[\w.-]+\/[\w.-]+$/.test(entry));
}

function clampCommits(value, fallback = 3) {
  // Bewusst nicht `value || fallback`: eine 0 ist falsy und würde
  // stillschweigend zum Standardwert werden.
  const requested = Number(value);
  return Math.min(Math.max(Number.isFinite(requested) ? requested : fallback, 1), 10);
}

/**
 * @param adapter.baseUrl      (config) => Adresse der Schnittstelle
 * @param adapter.headers      (config) => Kopfzeilen inklusive Anmeldung
 * @param adapter.commitsPath  (repo, count) => Pfad zur Commit-Liste
 * @param adapter.starsOf      (info) => Anzahl der Sterne
 * @param adapter.insecure     (config) => Zertifikatsprüfung aussetzen?
 */
function defineForgeModule({ name, displayName, adapter, defaults = {} }) {
  const moduleDefaults = {
    repos: '',
    maxCommits: 3,
    showOpenIssues: true,
    showStars: true,
    updateInterval: 300000,
    minInterval: 60000,
    ...defaults
  };

  function requestsFor(config) {
    const repos = parseRepos(config.repos);
    const base = adapter.baseUrl(config);
    if (repos.length === 0 || !base) return [];

    const headers = adapter.headers(config);
    const allowInsecureTls = adapter.insecure ? adapter.insecure(config) : false;
    const count = clampCommits(config.maxCommits, moduleDefaults.maxCommits);

    // Reihenfolge ist bedeutsam - transform() verlässt sich darauf.
    return repos.flatMap(repo => [
      { url: `${base}/repos/${repo}`, headers, allowInsecureTls },
      { url: `${base}${adapter.commitsPath(repo, count)}`, headers, allowInsecureTls }
    ]);
  }

  return defineHttpModule({
    name,
    defaults: moduleDefaults,

    buildRequests: requestsFor,

    transform(responses, config) {
      const repos = parseRepos(config.repos);

      return {
        provider: name,
        displayName,
        repos: repos.map((repo, index) => {
          const info = responses[index * 2] || {};
          const commits = responses[index * 2 + 1] || [];

          return {
            name: repo,
            shortName: repo.split('/')[1],
            stars: adapter.starsOf(info),
            openIssues: info.open_issues_count ?? null,
            commits: (Array.isArray(commits) ? commits : []).map(entry => ({
              // Nur die erste Zeile: Commit-Nachrichten haben oft einen
              // mehrzeiligen Rumpf, der die Anzeige sprengen würde.
              message: String(entry.commit?.message || '').split('\n')[0],
              author: entry.commit?.author?.name || entry.author?.login || 'unbekannt',
              date: entry.commit?.author?.date || null,
              sha: (entry.sha || '').slice(0, 7)
            }))
          };
        }),
        showOpenIssues: config.showOpenIssues !== false,
        showStars: config.showStars !== false
      };
    },

    async testConnection(config, request) {
      const repos = parseRepos(config.repos);
      if (repos.length === 0) {
        return { ok: false, error: 'Keine gültigen Repositories angegeben (Format: besitzer/name).' };
      }

      const base = adapter.baseUrl(config);
      if (!base) {
        return { ok: false, error: 'Es fehlt noch die Adresse der Instanz.' };
      }

      try {
        const response = await request({
          url: `${base}/repos/${repos[0]}`,
          headers: adapter.headers(config),
          allowInsecureTls: adapter.insecure ? adapter.insecure(config) : false,
          conditional: false
        });

        return {
          ok: true,
          repo: response.data.full_name || repos[0],
          authenticated: Boolean(config.token)
        };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
  });
}

module.exports = { defineForgeModule, parseRepos, clampCommits };
