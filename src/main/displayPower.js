const { execFile } = require('node:child_process');

/**
 * Den Bildschirm an- und ausschalten.
 *
 * Das lag früher im mmWave-Modul, weil dort der Anlass dafür entstand: kein
 * Mensch im Raum, also Bildschirm aus. Mit dem Sensor verschwand die
 * Fähigkeit — obwohl sie gar nichts mit ihm zu tun hat. Der Duschmodus
 * braucht sie (`shower.display: "off"`), die Gestensteuerung braucht sie
 * (`display.wake`, `display.toggle`), und ein künftiger Sensor bräuchte sie
 * genauso. Deshalb steht sie jetzt im Kern und gehört keinem Modul.
 *
 * Zwei Wege, in dieser Reihenfolge:
 *   1. `vcgencmd display_power` — schaltet auf dem Pi den HDMI-Ausgang.
 *   2. `xset dpms force` — greift, wo es kein vcgencmd gibt (Dev-Rechner,
 *      Pi 5 mit KMS), und schaltet wenigstens den Bildschirmschoner.
 *
 * Scheitern beide, bleibt der Zustand auf dem alten Wert. Ein Bildschirm,
 * von dem wir behaupten, er sei aus, obwohl er leuchtet, wäre schlimmer als
 * ein Fehler — deshalb wird `on` erst nach Erfolg umgesetzt.
 */
class DisplayPower {
  constructor({ bus, display = ':0' } = {}) {
    this.bus = bus;
    this.display = display;
    // Zustand je Ausgang. Zwei Bildschirme am selben Pi sollen sich einzeln
    // abschalten lassen - vcgencmd kann das nicht, xrandr schon.
    this.ausgaenge = new Map();
    // Beim Start wissen wir es nicht sicher. Wir nehmen "an" an: der Spiegel
    // hängt an der Wand und leuchtet, sonst würde niemand dieses Programm
    // starten. Der erste echte Schaltvorgang setzt den Wert verlässlich.
    this.on = true;
  }

  /** Aktueller Zustand, so gut wir ihn kennen. */
  state() {
    return {
      on: this.on,
      outputs: Object.fromEntries(this.ausgaenge)
    };
  }

  /** Welche Ausgänge gibt es, und hängt etwas daran? */
  async outputs() {
    const { ok, text } = await this._lies('xrandr', ['--query'], {
      env: { ...process.env, DISPLAY: process.env.DISPLAY || this.display }
    });
    if (!ok) return [];

    return text.split('\n')
      .filter(z => / connected| disconnected/.test(z))
      .map(z => {
        const [name, zustand] = z.split(/\s+/);
        return {
          name,
          connected: zustand === 'connected',
          on: this.ausgaenge.get(name) !== false
        };
      });
  }

  /**
   * Einen einzelnen Ausgang schalten.
   *
   * `vcgencmd display_power` kennt nur "den Bildschirm". Wer zwei Anzeigen
   * am selben Pi hat, will sie getrennt abschalten koennen - dafuer gibt es
   * nur xrandr.
   */
  async setOutput(name, on) {
    if (!name) return this.set(on);

    const args = on ? ['--output', name, '--auto'] : ['--output', name, '--off'];
    const ok = await this._run('xrandr', args, {
      env: { ...process.env, DISPLAY: process.env.DISPLAY || this.display }
    });

    if (!ok) {
      console.warn(`Ausgang ${name} liess sich nicht schalten.`);
      return this.state();
    }

    this.ausgaenge.set(name, Boolean(on));
    if (this.bus) this.bus.emit('presence:display', { on: Boolean(on), output: name });
    return this.state();
  }

  /** Ein Befehl, dessen Ausgabe gebraucht wird. */
  _lies(command, args, options = {}) {
    return new Promise(resolve => {
      execFile(command, args, { timeout: 5000, ...options }, (err, stdout) => {
        resolve({ ok: !err, text: stdout || '' });
      });
    });
  }

  /**
   * Schaltet den Bildschirm. Ein Aufruf, der nichts ändert, ist billig und
   * still — der Duschmodus darf das im Sekundentakt aufrufen.
   */
  async set(on) {
    const wanted = Boolean(on);
    if (this.on === wanted) return this.state();

    const ok = await this._vcgencmd(wanted) || await this._xset(wanted);
    if (!ok) {
      console.warn('Bildschirm liess sich nicht schalten - Zustand unveraendert.');
      return this.state();
    }

    this.on = wanted;
    // Dasselbe Thema wie früher: Spiegel und Web-Oberfläche hören schon
    // darauf, es ändert sich für sie nichts.
    if (this.bus) this.bus.emit('presence:display', { on: wanted });
    return this.state();
  }

  toggle() {
    return this.set(!this.on);
  }

  _vcgencmd(on) {
    return this._run('vcgencmd', ['display_power', on ? '1' : '0']);
  }

  _xset(on) {
    return this._run('xset', ['dpms', 'force', on ? 'on' : 'off'], {
      env: { ...process.env, DISPLAY: process.env.DISPLAY || this.display }
    });
  }

  _run(command, args, options = {}) {
    return new Promise(resolve => {
      execFile(command, args, { timeout: 5000, ...options }, (err) => resolve(!err));
    });
  }

  /**
   * Routen. Bewusst unter `/api/display` und nicht mehr unter
   * `/api/presence` — mit dem Sensor hat das nichts zu tun.
   */
  registerRoutes(app) {
    app.get('/api/display', (req, res) => res.json(this.state()));

    app.get('/api/display/outputs', async (req, res) => res.json(await this.outputs()));

    app.post('/api/display/output', async (req, res) => {
      const { output, on } = req.body || {};
      if (!output) return res.status(400).json({ error: 'Kein Ausgang angegeben.' });
      res.json(await this.setOutput(output, Boolean(on)));
    });

    app.post('/api/display/on', async (req, res) => res.json(await this.set(true)));
    app.post('/api/display/off', async (req, res) => res.json(await this.set(false)));
    app.post('/api/display/toggle', async (req, res) => res.json(await this.toggle()));
  }
}

module.exports = { DisplayPower };
