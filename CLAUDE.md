# MagicMirror⁴ — Arbeitsnotizen

Kein MagicMirror²-Fork, sondern eine eigene Electron-App. Wer die
MM²-Begriffe sucht (`Module.register`, `node_helper`, Regionen wie
`top_bar`), findet sie hier nicht.

## Aufbau

| Bereich | Ort | Rolle |
| --- | --- | --- |
| Hauptprozess | `src/main/` | Fenster je Display, Express-Server, Bus, Konfiguration |
| Spiegel | `src/renderer/` | die Anzeige selbst |
| Web-Oberfläche | `src/webui/public/` | Bedienung am Handy und am Rechner |
| Gemeinsam | `src/shared/` | läuft in beiden Welten (Bus, Manifest-Auslegung) |
| Module | `modules/<name>/` | je Ordner ein Modul |
| Themes | `themes/<name>/` | je Ordner ein Theme |

Der Spiegel wird über HTTP von `/mirror` ausgeliefert, nicht per `file://`.
Das macht relative `fetch`-Aufrufe möglich, erlaubt später die Ansicht am
Handy — und `http://127.0.0.1` gilt in Chromium als *secure context*.
Scheitert das Laden, fällt `loadMirror()` auf `loadFile()` zurück: ein toter
Server darf den Spiegel nie schwarz lassen.

## Ein Modul schreiben

```
modules/mein-modul/
  module.json    Manifest: Name, Config-Schema, Geheimnisse
  index.js       läuft im Renderer
  styles.css     optional, wird zur Laufzeit injiziert
  backend.js     optional, läuft im Hauptprozess
```

`index.js` erbt von `MMModule` und registriert sich am Ende:

```js
const ModuleBase = (typeof window !== 'undefined' && window.MMModule) || class {};

class MeinModul extends ModuleBase {
  static moduleName = 'mein-modul';
  static patchable = ['zeigeDetails'];   // ändert sich, ohne Neuaufbau

  async init() { }                        // asynchrone Vorbereitung, kein DOM
  render() { return element; }            // genau einmal; null = ohne Anzeige
  update() { }                            // punktuell ändern, nie neu aufbauen
  destroy() { if (super.destroy) super.destroy(); }
}

if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules['mein-modul'] = MeinModul;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MeinModul;
}
```

`modules/example-hidden/` ist die vollständige Vorlage.

Was die Basisklasse mitbringt: `this.timers` (räumt sich beim Zerstören selbst
ab), `this.http` (Basis-URL bereits aufgelöst), `this.subscribe` (Bus-Abo, das
ebenfalls automatisch endet), `this.html` (escapendes Template-Tag),
`this.requestUpdate()` (bündelt mehrere Anfragen zu einem Neuzeichnen).

### Regeln, die aus Fehlern entstanden sind

* **Kein `innerHTML`-Neuaufbau bei jeder Aktualisierung.** Die Uhr tat das
  jede Sekunde. Dadurch entstanden jede Sekunde neue Knoten, und die
  Endlos-Animationen der Themes starteten jedes Mal bei Frame 0 — das war das
  sichtbare Ruckeln. In `update()` nur schreiben, was sich geändert hat.
* **Keine rohen Farben in `styles.css`.** Was nicht über ein Token läuft, kann
  kein Theme umfärben — und im Standard-Theme sieht es trotzdem richtig aus.
  `npm run check:tokens` weist das ab.
* **Keine eigenen `setInterval`.** `this.timers.every()` benutzen. Für alles
  im Sekundentakt am gemeinsamen `tick:second` hängen.
* **Fremde Daten nur über `this.html`.** Fach-, Raum- und Lehrernamen kommen
  von einer fremden API; ungeprüft in `innerHTML` führen sie Code aus.
* **Nichts auf oberster Ebene deklarieren, was ein anderes Modul auch heißen
  könnte.** Module werden als ES-Module geladen und haben damit ihren eigenen
  Scope — unter `file://` aber als klassische Scripts mit *einem gemeinsamen*
  globalen Scope. Zwei Module mit `const h` ließen dort das zweite mit einem
  SyntaxError scheitern, sichtbar nur als „Modul konnte nicht geladen werden".
  `tests/module-scope.test.js` wacht darüber.
* **Keine globalen `process.on`-Handler in einem Backend.** Ein Modul hatte
  einen `uncaughtException`-Handler installiert, der Fehler der gesamten
  Anwendung schluckte. Der zentrale Handler steht in `src/main/main.js`.

### Geheimnisse

Im Manifest deklarieren — nicht im Kern eintragen:

```json
"secrets": [
  { "key": "apiKey", "env": "MEIN_MODUL_API_KEY",
    "label": "API-Schlüssel", "exposeToRenderer": false }
]
```

Der Wert wandert beim Speichern in die `.env` und wird beim Laden wieder in
`mod.config` eingesetzt. `exposeToRenderer: false` heißt, dass er den Browser
nie erreicht — das Modul muss dann über sein `backend.js` gehen. Über HTTP
liefert `GET /api/config` ohnehin nur `"__SET__"`.

### Backend

```js
module.exports = {
  registerRoutes(app, { instanceName, ConfigManager, fetch, bus }) {
    app.get('/api/mein-modul/data', async (req, res) => { });
  }
};
```

`bus.emit('mein-modul:changed', payload)` erreicht Spiegel und Web-Oberfläche,
ohne eines von beiden zu kennen. Die ältere Form `{ routes: [...] }` wird
weiterhin unterstützt (`modules/untis/backend.js` benutzt sie).

`backend.js` wird **nie** über HTTP ausgeliefert — es läuft im Hauptprozess
und hat Zugriff auf Konfiguration und `.env`.

## Ein Theme schreiben

```
themes/mein-theme/
  theme.css     @layer theme { :root { --mm-color-accent: ...; } }
  theme.json    { "name": "...", "mode": "dark", "description": "..." }
```

Ein Theme belegt Tokens neu und muss die Module nicht kennen. **Kein
`!important` nötig:** Modul-CSS liegt in `@layer module`, Themes in
`@layer theme`, und Layer-Reihenfolge schlägt Spezifität *und*
Quellreihenfolge. Der Perf-Schalter liegt darüber in `@layer overrides` —
deshalb kann `html[data-perf="low"]` jedem Theme den Blur abschalten.

Alle Tokens: `src/renderer/styles/tokens.css`.

## Ereignis-Bus

Ein Bus, drei Transporte (lokal, IPC, WebSocket). Themen sind mit Doppelpunkt
gegliedert und mit `*` abonnierbar.

| Namensraum | Bedeutung |
| --- | --- |
| `tick:second`, `tick:minute` | gemeinsamer Takt |
| `presence:changed`, `presence:display` | Anwesenheitssensor |
| `system:*`, `config:*`, `theme:*` | Kern |
| `<modul>:*` | modul-eigen |

## Prüfen

```bash
npm run verify        # Lint + Token-Disziplin + Tests
npm run check:tokens  # nur die Farbprüfung
npm run routes        # zeigt alle registrierten Modul-Routen
npm run dev           # Electron mit DevTools
```

Es gibt noch **keinen** Test, der die App tatsächlich startet. Die Tests in
`tests/server-wiring.test.js` prüfen deshalb am Quelltext, dass sicherheits-
relevante Verdrahtung erhalten bleibt — dort würde eine gelöschte Zeile den
Server sonst still wieder öffnen, ohne dass etwas rot wird. Sie werden
ersetzt, sobald der Server aus `main.js` herausgelöst ist.

## Anmeldung

Der Konfigurations-Server ist nicht offen. Kopplung per QR-Code, der
ausschließlich auf dem Spiegel erscheint. **Loopback ist ausgenommen** — die
Module holen ihre Daten per HTTP von der eigenen Adresse, und wer Zugriff auf
den Pi hat, hat ohnehin eine Shell. `trust proxy` bleibt deshalb aus: sonst
könnte ein `X-Forwarded-For`-Header eine entfernte Anfrage als lokal ausgeben.

`MM_AUTH=off` ist der Notausgang, falls man sich aussperrt.

## Wenn Schriften geändert werden

`npm run fonts:build` lädt sie neu und erzeugt `fonts.css`. Nicht von Hand
bearbeiten. Die Schriften liegen bewusst lokal: ein `<link>` oder `@import`
auf Google ist ein Netzwerk-Roundtrip beim Booten, auf einem Gerät, das dann
womöglich noch kein Netz hat.
