// Gemeinsame Anzeige für GitHub und Gitea.
//
// Beide zeigen dasselbe: Repository, Sterne, offene Vorgänge, die letzten
// Commits. Zwei fast gleiche Dateien nebeneinander wären zwei Stellen, an
// denen dieselbe Änderung nachgezogen werden muss.
(function () {
  const Base = (typeof window !== 'undefined' && window.DataModule) || class {};

  class ForgeModule extends Base {
    static patchable = ['maxCommits', 'showStars', 'showOpenIssues'];

    constructor(config = {}) {
      super(config);

      this.config = {
        maxCommits: config.maxCommits || 3,
        showStars: config.showStars !== false,
        showOpenIssues: config.showOpenIssues !== false,
        language: config.language || 'de',
        ...config
      };
    }

    get title() {
      return this.constructor.displayName || this.constructor.moduleName;
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
      box.className = 'forge-repo';

      const header = document.createElement('div');
      header.className = 'dm-row forge-repo-header';

      const name = document.createElement('span');
      name.className = 'forge-repo-name';
      name.textContent = repo.shortName || repo.name;
      header.appendChild(name);

      const badges = document.createElement('span');
      badges.className = 'forge-badges';

      if (data.showStars && repo.stars !== null) {
        badges.appendChild(this.buildPill(`★ ${this.formatCount(repo.stars)}`));
      }

      if (data.showOpenIssues && repo.openIssues) {
        badges.appendChild(this.buildPill(`${repo.openIssues} offen`, 'warn'));
      }

      header.appendChild(badges);
      box.appendChild(header);

      if (repo.commits.length === 0) {
        box.appendChild(this.buildNotice('dm-error', 'Keine Commits gefunden.'));
        return box;
      }

      const list = document.createElement('div');
      list.className = 'forge-commits';

      for (const commit of repo.commits.slice(0, this.config.maxCommits)) {
        list.appendChild(this.renderCommit(commit));
      }

      box.appendChild(list);
      return box;
    }

    renderCommit(commit) {
      const item = document.createElement('div');
      item.className = 'forge-commit';

      const message = document.createElement('div');
      message.className = 'forge-commit-message';
      message.textContent = commit.message;
      item.appendChild(message);

      const meta = document.createElement('div');
      meta.className = 'forge-commit-meta';
      meta.textContent = `${commit.author} · ${this.formatAge(
        commit.date ? new Date(commit.date).getTime() : null
      )}`;
      item.appendChild(meta);

      return item;
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

  if (typeof window !== 'undefined') {
    window.ForgeModule = ForgeModule;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ForgeModule };
  }
})();
