const fs = require('node:fs');
const path = require('node:path');

/**
 * Findet die verfügbaren Themes durch Scannen des themes/-Verzeichnisses.
 *
 * Vorher stand die Auswahl fest verdrahtet in der Web-UI - eine neue
 * Theme-Datei war damit unsichtbar, bis jemand das HTML anfasste.
 *
 * Zwei Ablageformen werden unterstützt:
 *
 *   themes/<name>/theme.css + theme.json   bevorzugt, mit Metadaten
 *   themes/<name>.css                      alte, flache Form
 */
class ThemeManager {
  constructor(themesDir) {
    this.themesDir = themesDir;
  }

  scanThemes() {
    const themes = [{
      id: 'default',
      name: 'Standard',
      description: 'Die Grundschicht ohne zusätzliches Theme.',
      mode: 'dark',
      href: null,
      supports: { blur: false, ambientMotion: false }
    }];

    let entries;
    try {
      entries = fs.readdirSync(this.themesDir, { withFileTypes: true });
    } catch {
      return themes;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        const cssPath = path.join(this.themesDir, entry.name, 'theme.css');
        if (!fs.existsSync(cssPath)) continue;
        themes.push(this._describe(entry.name, `${entry.name}/theme.css`));
      } else if (entry.isFile() && entry.name.endsWith('.css')) {
        const id = entry.name.replace(/\.css$/, '');
        themes.push(this._describe(id, entry.name, { legacy: true }));
      }
    }

    return themes;
  }

  _describe(id, relativeHref, { legacy = false } = {}) {
    const theme = {
      id,
      // Ohne Metadaten wenigstens einen lesbaren Namen erzeugen.
      name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: '',
      mode: 'dark',
      author: '',
      href: relativeHref,
      legacy,
      supports: { blur: false, ambientMotion: true }
    };

    const metaPath = path.join(this.themesDir, id, 'theme.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        Object.assign(theme, {
          name: meta.name || theme.name,
          description: meta.description || '',
          mode: meta.mode === 'light' ? 'light' : 'dark',
          author: meta.author || '',
          supports: { ...theme.supports, ...(meta.supports || {}) }
        });
      } catch (error) {
        console.error(`Theme ${id}: theme.json ist fehlerhaft -`, error.message);
      }
    }

    return theme;
  }

  hasTheme(id) {
    return this.scanThemes().some((theme) => theme.id === id);
  }
}

module.exports = ThemeManager;
