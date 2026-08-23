const { defineForgeModule } = require('../../src/main/integrations/forge');

/**
 * GitHub.
 *
 * Der gesamte Unterschied zu Gitea steckt in diesem Adapter - alles andere
 * kommt aus dem gemeinsamen Kern.
 *
 * Zum Kontingent: ohne Token erlaubt GitHub 60 Anfragen pro Stunde, mit Token
 * 5000. Zwei Anfragen je Repository alle fünf Minuten sind bei drei
 * Repositories schon 72 pro Stunde - ohne Token also nicht tragfähig. Die
 * bedingten Anfragen aus dem Fundament helfen zusätzlich: eine 304-Antwort
 * zählt gar nicht.
 */
module.exports = defineForgeModule({
  name: 'github',
  displayName: 'GitHub',

  adapter: {
    baseUrl: () => 'https://api.github.com',

    headers: (config) => ({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // GitHub verlangt einen User-Agent und antwortet sonst mit 403.
      'User-Agent': 'MagicMirror4',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
    }),

    commitsPath: (repo, count) => `/repos/${repo}/commits?per_page=${count}`,

    starsOf: (info) => info.stargazers_count ?? null
  }
});
