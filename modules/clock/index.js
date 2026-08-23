class ClockModule {
  constructor(config = {}) {
    this.config = {
      timeFormat: config.timeFormat || 'HH:mm:ss',
      showDate: config.showDate !== false,
      dateFormat: config.dateFormat || 'dddd, DD. MMMM YYYY',
      timezone: config.timezone || 'Europe/Vienna',
      language: config.language || 'en'
    };

    this.translations = {
      'de': {
        days: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
        months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
      },
      'en': {
        days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      }
    };

    this.container = null;
    this.updateInterval = null;

    // Stabile Referenzen auf die Zeit-Spans. Sie werden einmal in render()
    // erzeugt und danach nur noch per textContent beschrieben - ein
    // innerHTML-Neuaufbau pro Sekunde würde die CSS-Animationen der Themes
    // jede Sekunde von vorne starten lassen.
    this.partElements = [];
    this.suffixElement = null;
    this.dateElement = null;
    this.lastParts = [];
    this.lastSuffix = null;
    this.lastDate = null;
  }

  get t() {
    return this.translations[this.config.language] || this.translations['en'];
  }

  get use12h() {
    return /A/.test(this.config.timeFormat) || /hh/.test(this.config.timeFormat);
  }

  get showSeconds() {
    return /ss/.test(this.config.timeFormat);
  }

  // Zerlegt die aktuelle Zeit in die Teile, die auch angezeigt werden.
  getTimeParts(now) {
    let hours = now.getHours();
    const suffix = this.use12h ? (hours >= 12 ? 'PM' : 'AM') : '';

    if (this.use12h) {
      hours = hours % 12 || 12;
    }

    const parts = [
      hours.toString().padStart(2, '0'),
      now.getMinutes().toString().padStart(2, '0')
    ];

    if (this.showSeconds) {
      parts.push(now.getSeconds().toString().padStart(2, '0'));
    }

    return { parts, suffix };
  }

  render() {
    this.container = document.createElement('div');
    this.container.className = 'module-clock';

    const timeElement = document.createElement('div');
    timeElement.className = 'clock-time';

    const { parts, suffix } = this.getTimeParts(new Date());
    const partNames = ['hours', 'minutes', 'seconds'];

    parts.forEach((value, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.className = 'clock-separator';
        separator.textContent = ':';
        timeElement.appendChild(separator);
      }

      const span = document.createElement('span');
      span.className = `clock-time-part ${partNames[index]}`;
      span.textContent = value;
      timeElement.appendChild(span);
      this.partElements.push(span);
    });

    this.lastParts = parts.slice();

    if (suffix) {
      this.suffixElement = document.createElement('span');
      this.suffixElement.className = 'clock-time-suffix';
      this.suffixElement.textContent = suffix;
      timeElement.appendChild(this.suffixElement);
      this.lastSuffix = suffix;
    }

    this.container.appendChild(timeElement);

    if (this.config.showDate) {
      this.dateElement = document.createElement('div');
      this.dateElement.className = 'clock-date';
      this.container.appendChild(this.dateElement);
    }

    this.update();
    this.updateInterval = setInterval(() => this.update(), 1000);

    return this.container;
  }

  update() {
    if (!this.container) return;

    const now = new Date();
    const { parts, suffix } = this.getTimeParts(now);

    // Nur schreiben, was sich tatsächlich geändert hat.
    parts.forEach((value, index) => {
      if (this.lastParts[index] !== value && this.partElements[index]) {
        this.partElements[index].textContent = value;
        this.lastParts[index] = value;
      }
    });

    if (this.suffixElement && this.lastSuffix !== suffix) {
      this.suffixElement.textContent = suffix;
      this.lastSuffix = suffix;
    }

    if (this.config.showDate && this.dateElement) {
      const dateString = this.formatDate(now);
      if (this.lastDate !== dateString) {
        this.dateElement.textContent = dateString;
        this.lastDate = dateString;
      }
    }
  }

  formatDate(now) {
    const dayName = this.t.days[now.getDay()];
    const month = this.t.months[now.getMonth()];
    const day = now.getDate();
    const year = now.getFullYear();

    // Platzhalter verhindern, dass sich die Ersetzungen gegenseitig zerlegen.
    let dateString = this.config.dateFormat;
    dateString = dateString.replace('dddd', '{{DAY_NAME}}');
    dateString = dateString.replace('DD', day.toString().padStart(2, '0'));
    // 'D' nur ersetzen wenn es nicht Teil von '{{DAY_NAME}}' ist
    dateString = dateString.replace(/(?<!\{)D(?!\}|AY)/g, day.toString());
    dateString = dateString.replace('MMMM', '{{MONTH_NAME}}');
    dateString = dateString.replace('MMM', month.substring(0, 3));
    dateString = dateString.replace('MM', (now.getMonth() + 1).toString().padStart(2, '0'));
    dateString = dateString.replace('YYYY', year.toString());
    dateString = dateString.replace('YY', year.toString().substring(2));
    dateString = dateString.replace('{{DAY_NAME}}', dayName);
    dateString = dateString.replace('{{MONTH_NAME}}', month);

    return dateString;
  }

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.partElements = [];
    this.suffixElement = null;
    this.dateElement = null;
    this.container = null;
  }
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules.clock = ClockModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClockModule;
}
