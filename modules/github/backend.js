const { defineHttpModule } = require('../../src/main/integrations/httpModule');

/**
 * GitHub-Anbindung.
 *
 * Das ganze Modul-Backend besteht aus zwei Funktionen: welche Anfragen
 * gestellt werden und wie das Ergebnis aussehen soll. Abfragetakt,
 * Zwischenspeicher, Backoff, bedingte Anfragen, Fehlerbehandlung und die
 * Routen kommen aus defineHttpModule.
 *
 * Zum Kontingent: ohne Token erlaubt GitHub 60 Anfragen pro Stunde, mit Token
 * 5000. Zwei Anfragen je Repository alle fünf Minuten sind bei drei
 * Repositories schon 72 pro Stunde - ohne Token also nicht tragfähig. Die
 * bedingten Anfragen aus dem Fundament helfen zusätzlich: eine
 * 304-Antwort zählt gar nicht.
 */

const API = 'https://api.github.com';

function parseRepos(value) {
  return String(value || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => /^[\w.-]+\/[\w.-]+$/.test(entry));
}

function headersFor(config) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub verlangt einen User-Agent und antwortet sonst mit 403.
    'User-Agent': 'MagicMirror4'
  };

  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  return headers;
}

module.exports = defineHttpModule({
  name: 'github',

  defaults: {
    repos: '',
    maxCommits: 3,
    showPullRequests: true,
    showStars: true,
    updateInterval: 300000,
    minInterval: 60000
  },

  buildRequests(config) {
    const repos = parseRepos(config.repos);
    if (repos.length === 0) return [];

    const headers = headersFor(config);
    // Bewusst nicht `config.maxCommits || 3`: eine 0 ist falsy und wuerde
    // stillschweigend zu 3 werden, obwohl das Manifest 1 als Minimum nennt.
    const requested = Number(config.maxCommits);
    const perPage = Math.min(Math.max(Number.isFinite(requested) ? requested : 3, 1), 10);

    // Reihenfolge ist bedeutsam - transform() verlässt sich darauf.
    return repos.flatMap(repo => [
      { url: `${API}/repos/${repo}`, headers },
      { url: `${API}/repos/${repo}/commits?per_page=${perPage}`, headers }
    ]);
  },

  transform(responses, config) {
    const repos = parseRepos(config.repos);

    return {
      repos: repos.map((repo, index) => {
        const info = responses[index * 2] || {};
        const commits = responses[index * 2 + 1] || [];

        return {
          name: repo,
          shortName: repo.split('/')[1],
          stars: info.stargazers_count ?? null,
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
      showPullRequests: config.showPullRequests !== false,
      showStars: config.showStars !== false
    };
  },

  async testConnection(config, request) {
    const repos = parseRepos(config.repos);
    if (repos.length === 0) {
      return { ok: false, error: 'Keine gültigen Repositories angegeben (Format: besitzer/name).' };
    }

    try {
      const response = await request({
        url: `${API}/repos/${repos[0]}`,
        headers: headersFor(config),
        conditional: false
      });

      return {
        ok: true,
        repo: response.data.full_name,
        // Ohne Token ist das Kontingent der häufigste Grund für "geht nicht".
        authenticated: Boolean(config.token)
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
});
