class SpotifyModule {
  constructor(config = {}) {
    this.config = {
      clientId: config.clientId || '',
      clientSecret: config.clientSecret || '',
      refreshToken: config.refreshToken || '',
      showCover: config.showCover !== false,
      showProgress: config.showProgress !== false,
      showSpotifyCode: config.showSpotifyCode !== false,
      updateInterval: config.updateInterval || 5000
    };
    
    this.container = null;
    this.accessToken = null;
    this.currentTrack = null;
    this.updateInterval = null;
  }

  async render() {
    this.container = document.createElement('div');
    this.container.className = 'module-spotify';
    
    if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
      this.container.innerHTML = '<div class="spotify-error">Spotify nicht konfiguriert. Bitte OAuth durchführen.</div>';
      return this.container;
    }
    
    // Hole Access Token
    await this.refreshAccessToken();
    
    // Lade aktuellen Track
    await this.loadCurrentTrack();
    
    // Rendere UI
    this.renderUI();
    
    // Update regelmäßig
    this.updateInterval = setInterval(() => {
      this.loadCurrentTrack().then(() => this.renderUI());
    }, this.config.updateInterval);
    
    return this.container;
  }

  async refreshAccessToken() {
    if (!this.config.refreshToken) return;
    
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${this.config.clientId}:${this.config.clientSecret}`)
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.config.refreshToken
        })
      });
      
      const data = await response.json();
      if (data.access_token) {
        this.accessToken = data.access_token;
      }
    } catch (error) {
      console.error('Fehler beim Token-Refresh:', error);
    }
  }

  async loadCurrentTrack() {
    if (!this.accessToken) return;
    
    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });
      
      if (response.status === 204) {
        // Kein Track wird abgespielt
        this.currentTrack = null;
        return;
      }
      
      const data = await response.json();
      this.currentTrack = data;
    } catch (error) {
      console.error('Fehler beim Laden des aktuellen Tracks:', error);
    }
  }

  renderUI() {
    if (!this.currentTrack || !this.currentTrack.item) {
      this.container.innerHTML = '<div class="spotify-empty">Kein Song wird abgespielt</div>';
      return;
    }
    
    const track = this.currentTrack.item;
    const progress = this.currentTrack.progress_ms || 0;
    const duration = track.duration_ms || 0;
    const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;
    
    let html = '<div class="spotify-container">';
    
    // Song Info oben
    html += `<div class="spotify-info">
      <div class="spotify-title">${this.escapeHtml(track.name)}</div>
      <div class="spotify-artist">${this.escapeHtml(track.artists.map(a => a.name).join(', '))}</div>
    </div>`;
    
    // Album Cover
    if (this.config.showCover && track.album.images && track.album.images.length > 0) {
      const coverUrl = track.album.images[0].url;
      html += `<div class="spotify-cover">
        <img src="${coverUrl}" alt="Album Cover" />
      </div>`;
    }
    
    // Spotify Code & Controls
    html += `<div class="spotify-controls">
      <div class="spotify-logo">🎵</div>
      <div class="spotify-waveform">
        ${this.generateWaveform()}
      </div>
    </div>`;
    
    // Progress Bar
    if (this.config.showProgress) {
      html += `<div class="spotify-progress">
        <div class="spotify-progress-bar" style="width: ${progressPercent}%"></div>
      </div>`;
      
      html += `<div class="spotify-time">
        <span class="spotify-time-current">${this.formatTime(progress)}</span>
        <span class="spotify-time-total">${this.formatTime(duration)}</span>
      </div>`;
    }
    
    // Device Info
    if (this.currentTrack.device) {
      html += `<div class="spotify-device">
        <span class="spotify-device-icon">🖥️</span>
        <span class="spotify-device-name">${this.escapeHtml(this.currentTrack.device.name)}</span>
      </div>`;
    }
    
    html += '</div>';
    
    this.container.innerHTML = html;
  }

  generateWaveform() {
    // Generiere einfache Waveform-Visualisierung
    let waveform = '';
    for (let i = 0; i < 20; i++) {
      const height = Math.random() * 30 + 10;
      waveform += `<div class="waveform-bar" style="height: ${height}px"></div>`;
    }
    return waveform;
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
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
