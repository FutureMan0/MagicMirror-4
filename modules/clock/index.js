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
  }

  get t() {
    return this.translations[this.config.language] || this.translations['en'];
  }

  render() {
    this.container = document.createElement('div');
    this.container.className = 'module-clock';

    const timeElement = document.createElement('div');
    timeElement.className = 'clock-time';

    this.container.appendChild(timeElement);

    if (this.config.showDate) {
      const dateElement = document.createElement('div');
      dateElement.className = 'clock-date';
      this.container.appendChild(dateElement);
    }

    this.update();
    this.updateInterval = setInterval(() => this.update(), 1000);

    return this.container;
  }

  update() {
    if (!this.container) return;

    const now = new Date();

    // Format Zeit
    let hours = now.getHours().toString().padStart(2, '0');
    let minutes = now.getMinutes().toString().padStart(2, '0');
    let seconds = now.getSeconds().toString().padStart(2, '0');

    if (this.config.timeFormat.includes('A')) {
      // 12h Format
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      hours = hours.toString().padStart(2, '0');
    }

    const timeString = this.config.timeFormat
      .replace('HH', hours)
      .replace('hh', hours)
      .replace('mm', minutes)
      .replace('ss', seconds)
      .replace('A', now.getHours() >= 12 ? 'PM' : 'AM');

    const timeElement = this.container.querySelector('.clock-time');
    if (timeElement) {
      timeElement.textContent = timeString;
      timeElement.setAttribute('data-time', timeString);
    }

    // Format Datum
    if (this.config.showDate) {
      const days = this.t.days;
      const months = this.t.months;

      const dayName = days[now.getDay()];
      const day = now.getDate();
      const month = months[now.getMonth()];
      const year = now.getFullYear();

      // Verwende Platzhalter um Konflikte zu vermeiden
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
      // Platzhalter wieder einsetzen
      dateString = dateString.replace('{{DAY_NAME}}', dayName);
      dateString = dateString.replace('{{MONTH_NAME}}', month);

      const dateElement = this.container.querySelector('.clock-date');
      if (dateElement) {
        dateElement.textContent = dateString;
      }
    }
  }

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
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
