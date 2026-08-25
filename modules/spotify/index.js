// Spotify-Anzeige.
//
// Die alte Fassung erneuerte den Zugangs-Token im Browser - mit dem Client
// Secret, sichtbar in den Entwicklerwerkzeugen. Das ist jetzt Sache des
// Backends; hier kommt nur noch fertig aufbereitetes an.
var SpotifyBase = (typeof window !== 'undefined' && window.DataModule)
  || (typeof window !== 'undefined' && window.MMModule)
  || class {};

class SpotifyModule extends SpotifyBase {
  static moduleName = 'spotify';
  // Bewusst leer.
  //
  // `patchable` heisst: diese Schluessel lassen sich ohne Neuaufbau
  // uebernehmen. Das Modul baut seinen Inhalt aber nur bei einem Titelwechsel
  // auf - eine Aenderung an showCover, coverStyle oder showProgress aendert
  // die Struktur, und ohne Neuaufbau passiert schlicht nichts. Genau daran
  // ist die Schallplatte gescheitert: umgestellt, gespeichert, keine
  // Wirkung.
  static patchable = [];

  constructor(config = {}) {
    super(config);

    this.config = {
      showCover: config.showCover !== false,
      coverStyle: config.coverStyle || 'square',
      showProgress: config.showProgress !== false,
      showSpotifyCode: config.showSpotifyCode !== false,
      updateInterval: config.updateInterval || 5000,
      language: config.language || 'de',
      ...config
    };

    this.elements = {};
    this.lastTrackId = null;
  }

  get endpoint() {
    return '/api/spotify/now-playing';
  }

  get title() {
    return null;
  }

  render() {
    const container = super.render();

    // Der laufende Fortschritt kommt nicht vom Server: alle zwei Sekunden
    // nachzufragen wäre Verschwendung, und dazwischen stünde der Balken
    // still. Stattdessen wird lokal weitergezählt.
    if (this.bus) {
      this.subscribe('tick:second', () => this.tickProgress());
    } else {
      this.timers.every(1000, () => this.tickProgress());
    }

    // Der Titel selbst wird regelmässig geholt.
    this.timers.every(Math.max(this.config.updateInterval, 3000), () => this.reload());

    return container;
  }

  /** „Nichts läuft" sagt mehr als „nichts zu zeigen". */
  emptyText() {
    const englisch = (this.config.language || 'de') === 'en';
    return englisch ? 'Nothing playing.' : 'Gerade läuft nichts.';
  }

  renderData(data, root) {
    if (!data || !data.track) {
      root.textContent = '';
      this.elements = {};
      root.appendChild(this.buildNotice('dm-error', 'Gerade läuft nichts.'));
      return;
    }

    // Nur bei einem Titelwechsel neu aufbauen. Sonst würde jede Sekunde das
    // Cover neu geladen und die Anzeige flackern.
    if (data.track.id !== this.lastTrackId || !this.elements.title) {
      this.buildTrack(root, data);
      this.lastTrackId = data.track.id;
    }

    this.updateProgress(data.progressMs, data.track.durationMs);

    if (this.elements.state) {
      this.elements.state.textContent = data.isPlaying ? '▶' : '❚❚';
    }

      // Die Platte dreht sich nur, solange wirklich etwas laeuft. Eine
      // Platte, die bei pausierter Musik weiterdreht, ist schlimmer als
      // gar keine Animation.
      if (this.elements.platte) {
        this.elements.platte.classList.toggle('laeuft', Boolean(data.isPlaying));
      }
  }

  buildTrack(root, data) {
    root.textContent = '';
    this.elements = {};

    const layout = document.createElement('div');
    layout.className = 'spotify-layout';

    if (this.config.showCover && data.track.coverUrl) {
      const cover = document.createElement('img');
      cover.className = 'spotify-cover';
      cover.alt = '';
      cover.src = data.track.coverUrl;
      layout.appendChild(cover);
    }

    const info = document.createElement('div');
    info.className = 'spotify-info';

    this.elements.title = document.createElement('div');
    this.elements.title.className = 'spotify-title';
    this.elements.title.textContent = data.track.name;
    info.appendChild(this.elements.title);

    this.elements.artist = document.createElement('div');
    this.elements.artist.className = 'spotify-artist';
    this.elements.artist.textContent = data.track.artists.join(', ');
    info.appendChild(this.elements.artist);

    if (this.config.showProgress) {
      const bar = document.createElement('div');
      bar.className = 'dm-bar spotify-progress';

      this.elements.fill = document.createElement('div');
      this.elements.fill.className = 'dm-bar-fill';
      bar.appendChild(this.elements.fill);
      info.appendChild(bar);

      const times = document.createElement('div');
      times.className = 'spotify-times';

      this.elements.elapsed = document.createElement('span');
      this.elements.total = document.createElement('span');
      this.elements.state = document.createElement('span');
      this.elements.state.className = 'spotify-state';

      times.append(this.elements.elapsed, this.elements.state, this.elements.total);
      info.appendChild(times);
    }

    layout.appendChild(info);
    root.appendChild(layout);
  }

  /** Zählt lokal weiter, ohne dafür zu fragen. */
  tickProgress() {
    if (!this.data || !this.data.track || !this.data.isPlaying) return;

    this.data.progressMs = Math.min(
      this.data.progressMs + 1000,
      this.data.track.durationMs
    );

    this.updateProgress(this.data.progressMs, this.data.track.durationMs);
  }

    updateProgress(progressMs, durationMs) {
      // Nur die Dauer ist Pflicht: der Tonarm haengt nicht am
      // Fortschrittsbalken, der abgeschaltet sein kann.
      if (!durationMs) return;

      const percent = Math.min(100, (progressMs / durationMs) * 100);

      // Der Tonarm wandert von aussen nach innen: am Anfang steht er am
      // Rand, am Ende ueber dem Etikett. Die Winkel sind so gewaehlt, dass
      // die Nadel dabei innerhalb der Rillen bleibt.
      if (this.elements.tonarm) {
        const winkel = -22 + (percent / 100) * 16;
        this.elements.tonarm.style.setProperty('--tonarm-winkel', `${winkel}deg`);
      }

      if (this.elements.fill) this.elements.fill.style.width = `${percent}%`;
      if (this.elements.elapsed) this.elements.elapsed.textContent = this.formatTime(progressMs);
      if (this.elements.total) this.elements.total.textContent = this.formatTime(durationMs);
    }

  formatTime(ms) {
    const total = Math.floor((ms || 0) / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  destroy() {
    if (super.destroy) super.destroy();
    this.elements = {};
    this.lastTrackId = null;
  }
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.spotify = SpotifyModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpotifyModule;
}
