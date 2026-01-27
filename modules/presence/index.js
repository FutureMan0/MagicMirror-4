class PresenceModule {
  constructor(config = {}) {
    this.config = {
      port: config.port || '/dev/ttyUSB0',
      timeout: config.timeout || 60000,
      dimTimeout: config.dimTimeout || 300000,
      enabled: config.enabled !== false
    };
    
    this.isPresent = true;
    this.timeout = null;
    this.callbacks = [];
    this.connected = false;
    
    // Platzhalter für SerialPort - wird nur geladen wenn verfügbar
    this.SerialPort = null;
    this.port = null;
  }

  async init() {
    if (!this.config.enabled) {
      console.log('Presence Sensor deaktiviert');
      return;
    }

    try {
      // Versuche SerialPort zu laden (optional dependency)
      try {
        this.SerialPort = require('serialport');
        await this.connect();
      } catch (error) {
        console.log('SerialPort nicht verfügbar, verwende Platzhalter-Modus');
        this.simulatePresence();
      }
    } catch (error) {
      console.error('Fehler beim Initialisieren des Presence Sensors:', error);
      this.simulatePresence();
    }
  }

  async connect() {
    if (!this.SerialPort) return false;

    try {
      this.port = new this.SerialPort.SerialPort({
        path: this.config.port,
        baudRate: 9600,
        autoOpen: false
      });

      this.port.on('data', (data) => {
        this.handleSensorData(data);
      });

      this.port.on('error', (error) => {
        console.error('SerialPort Fehler:', error);
        this.simulatePresence();
      });

      await new Promise((resolve, reject) => {
        this.port.open((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      this.connected = true;
      console.log(`Presence Sensor verbunden auf ${this.config.port}`);
      return true;
    } catch (error) {
      console.error('Fehler beim Verbinden mit Presence Sensor:', error);
      this.simulatePresence();
      return false;
    }
  }

  handleSensorData(data) {
    // Erwartet: '1' = present, '0' = not present
    const presence = data.toString().trim() === '1';
    this.setPresence(presence);
  }

  setPresence(present) {
    if (this.isPresent === present) return;
    
    this.isPresent = present;
    
    if (present) {
      clearTimeout(this.timeout);
      this.notifyCallbacks(true);
    } else {
      this.timeout = setTimeout(() => {
        this.notifyCallbacks(false);
      }, this.config.timeout);
    }
  }

  onPresenceChange(callback) {
    this.callbacks.push(callback);
  }

  // Simuliert Bewegungserkennung (für Testing ohne Hardware)
  simulatePresence() {
    console.log('Presence Sensor Platzhalter - immer present');
    this.connected = true;
    this.setPresence(true);
    
    // Simuliere Abwesenheit nach Timeout
    this.timeout = setTimeout(() => {
      this.setPresence(false);
    }, this.config.timeout);
  }

  notifyCallbacks(present) {
    this.callbacks.forEach(callback => {
      try {
        callback(present);
      } catch (error) {
        console.error('Fehler in Presence Callback:', error);
      }
    });
  }

  getPresence() {
    return this.isPresent;
  }

  render() {
    // Presence Modul hat keine UI
    return null;
  }

  destroy() {
    clearTimeout(this.timeout);
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
    this.connected = false;
  }
}

module.exports = PresenceModule;
