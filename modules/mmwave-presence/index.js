// Bewusst `var` und nicht `const`: unter file:// werden Module als klassische
// Scripts geladen und teilen sich einen globalen Scope. Ein zweites `const`
// desselben Namens wuerde das Modul mit einem SyntaxError scheitern lassen.
// Als ES-Modul (der Normalfall) ist die Deklaration ohnehin modul-lokal.
var h = (typeof window !== 'undefined' && window.mmHtml)
  ? window.mmHtml
  : (strings, ...values) => strings.reduce((out, chunk, i) => out + String(values[i - 1] ?? '') + chunk);

class mmWavePresenceModule {
    constructor(config = {}) {
        this.config = {
            language: config.language || 'en',
            offDelay: config.offDelay || 60,
            sensitivity: config.sensitivity || 40,
            hideUI: config.hideUI || false,
            ...config
        };

        this.presence = false;
        this.lastPresence = null;
        this.displayOn = true;
        this.container = null;
        this.updateTimer = null;
        this.unsubscribe = null;
    }

    render() {
        // If UI should be hidden, backend continues running but no display
        if (this.config.hideUI) {
            // Create empty, invisible container element
            this.container = document.createElement('div');
            this.container.style.display = 'none';
            this.container.style.width = '0';
            this.container.style.height = '0';
            this.container.style.opacity = '0';
            this.container.style.pointerEvents = 'none';
            this.startUpdating(); // Backend communication continues
            return this.container;
        }
        
        this.container = document.createElement('div');
        this.container.className = 'module-mmwave-presence';

        const header = document.createElement('div');
        header.className = 'presence-header';
        header.innerHTML = '<i class="fas fa-user-shield"></i> mmWave Presence';
        this.container.appendChild(header);

        const statusContainer = document.createElement('div');
        statusContainer.className = 'presence-status';

        const indicator = document.createElement('div');
        indicator.className = 'presence-indicator';
        statusContainer.appendChild(indicator);

        const text = document.createElement('div');
        text.className = 'presence-text';
        text.textContent = 'Initializing...';
        statusContainer.appendChild(text);

        this.container.appendChild(statusContainer);

        const details = document.createElement('div');
        details.className = 'presence-details';
        this.container.appendChild(details);

        this.startUpdating();
        return this.container;
    }

    get apiBase() {
        return (typeof window !== 'undefined' && window.location.protocol === 'file:')
            ? 'http://localhost:3000'
            : '';
    }

    async updateStatus() {
        // Bei verstecktem Fenster nichts abfragen - spart auf dem Pi einen
        // dauerhaften HTTP-Roundtrip.
        if (typeof document !== 'undefined' && document.hidden) return;

        try {
            const response = await fetch(`${this.apiBase}/api/presence/status`);
            if (!response.ok) throw new Error('Network error');
            const data = await response.json();

            this.presence = data.present;
            this.lastPresence = data.lastPresence;
            this.displayOn = data.displayOn;

            this.updateUI();
        } catch (error) {
            console.error('Presence: Update failed', error);
            if (!this.container) return;
            const text = this.container.querySelector('.presence-text');
            if (text) text.textContent = 'Offline';
        }
    }

    updateUI() {
        if (!this.container) return;

        const indicator = this.container.querySelector('.presence-indicator');
        const text = this.container.querySelector('.presence-text');
        const details = this.container.querySelector('.presence-details');

        // hideUI: der Container hat bewusst keine Kindelemente. Die Daten
        // fliessen trotzdem weiter, nur gezeichnet wird nichts.
        if (!indicator || !text || !details) return;

        if (this.presence) {
            indicator.classList.add('active');
            text.textContent = this.config.language === 'de' ? 'Anwesend' : 'Present';
            this.container.classList.add('detected');
        } else {
            indicator.classList.remove('active');
            text.textContent = this.config.language === 'de' ? 'Keine Person' : 'No Presence';
            this.container.classList.remove('detected');
        }

        if (this.lastPresence) {
            const last = new Date(this.lastPresence);
            const timeStr = last.toLocaleTimeString(this.config.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            details.innerHTML = h`
        <div class="detail-item">
          <span>Last Presence:</span>
          <span>${timeStr}</span>
        </div>
        <div class="detail-item">
          <span>Sensitivity:</span>
          <span>${this.config.sensitivity}%</span>
        </div>
        <div class="detail-item">
          <span>Display:</span>
          <span class="${this.displayOn ? 'text-on' : 'text-off'}">${this.displayOn ? 'ON' : 'OFF'}</span>
        </div>
      `;
        }
    }

    startUpdating() {
        // Einmal den Ist-Zustand holen, danach zuhoeren. Frueher lief hier ein
        // Dauer-Poll - und weil der Endpunkt wegen eines Config-Fehlers gar
        // nicht existierte, waren das jahrelang 404er im Sekundentakt.
        this.updateStatus();

        if (window.mmBus) {
            this.unsubscribe = window.mmBus.on('presence:changed', (payload) => {
                if (!payload) return;
                this.presence = payload.present;
                if (payload.lastPresence) this.lastPresence = payload.lastPresence;
                this.updateUI();
            });

            // Deutlich seltener nachfassen: nur um Verbindungsstatus und
            // Zaehler aktuell zu halten, nicht fuer die Anwesenheit selbst.
            this.updateTimer = setInterval(() => this.updateStatus(), 60000);
            return;
        }

        // Ohne Bus (etwa in einem einfachen Browser) bleibt das Polling.
        this.updateTimer = setInterval(() => this.updateStatus(), 5000);
    }

    destroy() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.container = null;
    }
}

// Register
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
    window.MagicMirrorModules['mmwave-presence'] = mmWavePresenceModule;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = mmWavePresenceModule;
}
