// GitHub-Modul.
//
// Beweis für das Fundament: Ladeanzeige, Fehlerbehandlung, Kennzeichnung
// veralteter Daten, Nachladen über den Bus und Aufräumen kommen alle aus
// DataModule. Übrig bleibt renderData() - also nur die Frage, wie es aussehen
// soll.
var GithubBase = (typeof window !== 'undefined' && window.DataModule)
  || (typeof window !== 'undefined' && window.MMModule)
  || class {};

class GithubModule extends GithubBase {
  static moduleName = 'github';
  static patchable = ['maxCommits', 'showStars', 'showPullRequests'];

  constructor(config = {}) {
    super(config);

    this.config = {
      maxCommits: config.maxCommits || 3,
      showStars: config.showStars !== false,
      showPullRequests: config.showPullRequests !== false,
      language: config.language || 'de',
      ...config
    };
  }

  get title() {
    return 'GitHub';
  }

  renderData(data, root) {
    root.textContent = '';

    const repos = (data && data.repos) || [];
    if (repos.length === 0) {
      root.appendChild(this.buildNotice('dm-error', 'Keine Repositories eingetragen.'));
      return;
    }

    for (const repo of repos) {
      root.appendChild(this.renderRepo(repo, data));
    }
  }

  renderRepo(repo, data) {
    const box = document.createElement('div');
    box.className = 'github-repo';

    const header = document.createElement('div');
    header.className = 'dm-row github-repo-header';

    const name = document.createElement('span');
    name.className = 'github-repo-name';
    name.textContent = repo.shortName || repo.name;
    header.appendChild(name);

    const badges = document.createElement('span');
    badges.className = 'github-badges';

    if (data.showStars && repo.stars !== null) {
      badges.appendChild(this.buildPill(`★ ${this.formatCount(repo.stars)}`));
    }

    if (data.showPullRequests && repo.openIssues) {
      // GitHub zählt Pull Requests bei open_issues mit - das ist keine
      // Ungenauigkeit hier, sondern eine Eigenheit der Schnittstelle.
      badges.appendChild(this.buildPill(`${repo.openIssues} offen`, 'warn'));
    }

    header.appendChild(badges);
    box.appendChild(header);

    if (repo.commits.length === 0) {
      box.appendChild(this.buildNotice('dm-error', 'Keine Commits gefunden.'));
      return box;
    }

    const list = document.createElement('div');
    list.className = 'github-commits';

    for (const commit of repo.commits.slice(0, this.config.maxCommits)) {
      const item = document.createElement('div');
      item.className = 'github-commit';

      const message = document.createElement('div');
      message.className = 'github-commit-message';
      message.textContent = commit.message;
      item.appendChild(message);

      const meta = document.createElement('div');
      meta.className = 'github-commit-meta';
      meta.textContent = `${commit.author} · ${this.formatAge(
        commit.date ? new Date(commit.date).getTime() : null
      )}`;
      item.appendChild(meta);

      list.appendChild(item);
    }

    box.appendChild(list);
    return box;
  }

  buildPill(text, tone = null) {
    const pill = document.createElement('span');
    pill.className = 'dm-pill';
    if (tone) pill.dataset.tone = tone;
    pill.textContent = text;
    return pill;
  }

  formatCount(value) {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
  }
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.github = GithubModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GithubModule;
}
