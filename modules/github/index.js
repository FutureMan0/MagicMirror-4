// GitHub-Anzeige. Die gesamte Darstellung steckt in ForgeModule - hier bleibt
// nur, was GitHub von Gitea unterscheidet.
var GithubBase = (typeof window !== 'undefined' && window.ForgeModule)
  || (typeof window !== 'undefined' && window.DataModule)
  || class {};

class GithubModule extends GithubBase {
  static moduleName = 'github';
  static displayName = 'GitHub';
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.github = GithubModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GithubModule;
}
