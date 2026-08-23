const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Sensoren abschalten - und ehrlich darüber sein, wie weit das trägt.
 *
 * Eine Kamera in einem Raum, in dem geduscht wird, ist ein Vertrauensproblem.
 * Softwareseitig lässt sich einiges tun, aber eines muss klar sein:
 *
 *   **Ein Software-Aus ist Komfort, keine Garantie.** Die einzige
 *   überzeugende Abschaltung ist ein physischer Schalter im Kabel. Auf einem
 *   Raspberry Pi lässt sich nicht einmal ein einzelner USB-Port stromlos
 *   schalten - bei B+/2B/3B/4B/5 hängen alle Downstream-Ports zusammen,
 *   `uhubctl` schaltet also alle oder keinen.
 *
 * Was hier geht, in dieser Reihenfolge:
 *   1. Den Erkennungsprozess beenden.
 *   2. Einen zugehörigen systemd-Dienst stoppen.
 *   3. Das USB-Gerät vom Treiber lösen (unbind) - der einzige Software-Weg,
 *      der ein einzelnes Gerät isoliert.
 *
 * Und, genauso wichtig: **der Zustand wird gemessen, nicht angenommen.** Bei
 * unklarer Lage meldet getStatus() "aktiv" - im Zweifel die unangenehmere
 * Wahrheit.
 */

const USB_DEVICES = '/sys/bus/usb/devices';
const USB_UNBIND = '/sys/bus/usb/drivers/usb/unbind';

function run(command, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (error, stdout) => {
      resolve({ ok: !error, output: String(stdout || '').trim() });
    });
  });
}

class SensorPower {
  constructor({ vendorIds = [], serviceName = null, bus = null, log = console } = {}) {
    this.vendorIds = vendorIds.map(id => id.toLowerCase());
    this.serviceName = serviceName;
    this.bus = bus;
    this.log = log;

    this.desiredState = 'off';
    this.lastError = null;
    this.processes = new Set();
  }

  /** Ein Kindprozess, der beim Abschalten beendet werden soll. */
  track(child) {
    if (!child) return;
    this.processes.add(child);
    child.once('exit', () => this.processes.delete(child));
  }

  /** Sucht das USB-Gerät anhand der Hersteller-Kennung. */
  findUsbDevice() {
    if (this.vendorIds.length === 0) return null;

    let entries;
    try {
      entries = fs.readdirSync(USB_DEVICES);
    } catch {
      return null;
    }

    for (const entry of entries) {
      try {
        const vendor = fs.readFileSync(path.join(USB_DEVICES, entry, 'idVendor'), 'utf8').trim();
        if (this.vendorIds.includes(vendor.toLowerCase())) return entry;
      } catch {
        // Kein idVendor - kein USB-Gerät im gesuchten Sinn.
      }
    }

    return null;
  }

  async disable(reason = 'Privatsphäre') {
    this.desiredState = 'off';
    this.lastError = null;

    for (const child of this.processes) {
      try {
        child.kill('SIGTERM');
      } catch (error) {
        this.lastError = error.message;
      }
    }

    if (this.serviceName && process.platform === 'linux') {
      await run('sudo', ['-n', 'systemctl', 'stop', this.serviceName]);
    }

    const device = this.findUsbDevice();
    if (device && process.platform === 'linux') {
      try {
        fs.writeFileSync(USB_UNBIND, device);
      } catch (error) {
        // Meist fehlende Rechte. Der Nutzer soll das erfahren, statt sich auf
        // eine Abschaltung zu verlassen, die nicht stattgefunden hat.
        this.lastError = `USB-Gerät konnte nicht gelöst werden: ${error.message}`;
        this.log.warn?.(this.lastError);
      }
    }

    this.log.log?.(`Sensor abgeschaltet (${reason}).`);
    this.publish();
    return this.status();
  }

  async enable() {
    this.desiredState = 'on';
    this.lastError = null;

    if (this.serviceName && process.platform === 'linux') {
      await run('sudo', ['-n', 'systemctl', 'start', this.serviceName]);
    }

    this.publish();
    return this.status();
  }

  /**
   * Der gemessene Zustand.
   *
   * Bewusst nicht "was wir zuletzt angeordnet haben": eine Anzeige, die
   * behauptet, die Kamera sei aus, weil jemand das mal angeordnet hat, ist
   * schlimmer als gar keine Anzeige.
   */
  status() {
    const usbPresent = process.platform === 'linux' ? Boolean(this.findUsbDevice()) : false;
    const processAlive = this.processes.size > 0;

    // Im Zweifel "aktiv": wenn sich nichts feststellen lässt, ist die
    // unangenehmere Auskunft die richtige.
    const uncertain = this.lastError !== null;

    return {
      desired: this.desiredState,
      usbPresent,
      processAlive,
      active: uncertain || processAlive || (this.desiredState === 'on' && usbPresent),
      uncertain,
      lastError: this.lastError,
      // Damit die Oberfläche das auch sagen kann.
      note: 'Ein Software-Aus ist Komfort. Sicher ist nur ein Schalter im Kabel.'
    };
  }

  publish() {
    if (this.bus) this.bus.emit('privacy:sensor', this.status());
  }
}

module.exports = { SensorPower };
