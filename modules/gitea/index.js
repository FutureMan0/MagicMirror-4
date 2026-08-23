// Gitea-Anzeige. Wie GitHub - nur ein anderer Name.
var GiteaBase = (typeof window !== 'undefined' && window.ForgeModule)
  || (typeof window !== 'undefined' && window.DataModule)
  || class {};

class GiteaModule extends GiteaBase {
  static moduleName = 'gitea';
  static displayName = 'Gitea';
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.gitea = GiteaModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GiteaModule;
}
