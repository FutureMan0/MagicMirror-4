const { defineForgeModule } = require('../../src/main/integrations/forge');

/**
 * Gitea (und Forgejo).
 *
 * Unterschiede zu GitHub: eine eigene Adresse, `token` statt `Bearer` im
 * Authorization-Kopf, `limit` statt `per_page`, und `stars_count` statt
 * `stargazers_count`. Mehr nicht - deshalb der gemeinsame Kern.
 *
 * Selbst gehostete Instanzen laufen im Heimnetz oft mit einem
 * selbstsignierten Zertifikat; dafür gibt es allowInsecureTls.
 */
module.exports = defineForgeModule({
  name: 'gitea',
  displayName: 'Gitea',

  defaults: {
    instanceUrl: '',
    allowInsecureTls: false
  },

  adapter: {
    baseUrl: (config) => {
      const url = String(config.instanceUrl || '').trim().replace(/\/+$/, '');
      if (!url || !/^https?:\/\//.test(url)) return null;
      return `${url}/api/v1`;
    },

    headers: (config) => ({
      Accept: 'application/json',
      'User-Agent': 'MagicMirror4',
      // Gitea erwartet "token <wert>", nicht "Bearer <wert>".
      ...(config.token ? { Authorization: `token ${config.token}` } : {})
    }),

    commitsPath: (repo, count) => `/repos/${repo}/commits?limit=${count}`,

    starsOf: (info) => info.stars_count ?? null,

    insecure: (config) => config.allowInsecureTls === true
  }
});
