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

### Ein Modul, das eine fremde Schnittstelle abfragt

Dafür gibt es ein Fundament — **nicht selbst bauen**. `defineHttpModule`
liefert Abfragetakt, Zwischenspeicher auf Platte, Backoff, bedingte Anfragen,
Fehlerbehandlung und die Routen:

```js
const { defineHttpModule } = require('../../src/main/integrations/httpModule');

module.exports = defineHttpModule({
  name: 'mein-modul',
  defaults: { updateInterval: 300000 },
  buildRequests: (config) => [{ url: '…', headers: { … } }],
  transform: (antworten, config) => ({ … })
});
```

Daraus entstehen `GET /api/<name>/data`, `POST /api/<name>/refresh`,
`POST /api/<name>/test` und optionale `action/:id`-Routen.

Im Renderer erbt das Modul von `DataModule` und implementiert **nur**
`renderData(data, root)`. Ladeanzeige, Fehler, Kennzeichnung veralteter Daten,
Nachladen über den Bus und Aufräumen kommen aus der Basisklasse.

`modules/github/` ist das Beispiel: ein vollständiges Modul in rund 120 Zeilen
Frontend und 100 Zeilen Backend, von denen die Hälfte Kommentare sind.

Warum das ein Fundament braucht und nicht jedes Modul für sich: Ohne
Plattenspeicher steht der Spiegel nach jedem `pm2 restart` — also nach jedem
Update — minutenlang leer. Ohne Backoff schreibt ein nicht erreichbarer Dienst
dieselbe Fehlermeldung im Minutentakt. Ohne Bündelung fragen Spiegel,
Live-Ansicht und Konfigurationsseite dreimal dasselbe ab. Ohne ETag ist das
GitHub-Kontingent bei drei Repositories aufgebraucht.

### Backend von Hand

Wenn das Fundament nicht passt — etwa bei Push statt Abfrage:

```js
module.exports = {
  registerRoutes(app, { instanceName, ConfigManager, fetch, bus, onShutdown }) {
    app.get('/api/mein-modul/data', async (req, res) => { });
  }
};
```

`onShutdown(fn)` für Aufräumarbeiten — **keine eigenen Signal-Handler**.

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

## Privatsphäre

Der Spiegel hängt in einem Bad mit Dusche. Drei Dinge, die oft verwechselt
werden:

| | |
| :--- | :--- |
| **Inhalt** | Ein Gast soll nicht den Stundenplan sehen |
| **Sensoren** | Eine Kamera in einem Duschraum ist ein Problem für sich — unabhängig vom Bildschirminhalt |
| **Praktisches** | Beim Duschen beschlägt der Spiegel und man ist nass; eine riesige Uhr ist dann nützlicher |

Jedes Modul erklärt im Manifest, wie heikel sein Inhalt ist:

```json
"privacyLevel": "public" | "personal" | "sensitive",
"showInShower": true
```

**Fail-safe: ohne Angabe gilt ein Modul als `sensitive`.** Neue Module sind
damit privat, bis jemand sie ausdrücklich freigibt — nie umgekehrt. Ein
vergessenes Feld wäre sonst ein Datenleck.

Ausgeblendet wird über Attribute und CSS, **nicht durch Neuaufbau**: sofort,
flackerfrei, und die Module behalten ihren Zustand. Für echte statt bloß
optischer Privatsphäre können Module ein `setPrivacy(mode)` anbieten und ihre
Abfragen einstellen — ein ausgeblendetes Modul, das weiter alle 15 Minuten den
Stundenplan holt, wäre nur halb privat.

Zwei Regeln im Ablauf:

* **Der Sensor geht aus, bevor sich am Bildschirm etwas ändert.** Andersherum
  gäbe es einen Moment, in dem der Spiegel schon privat aussieht, die Kamera
  aber noch läuft — genau der falsche Eindruck.
* **Der Sensorzustand wird gemessen, nicht angenommen.** Bei unklarer Lage
  meldet `getStatus()` „aktiv". Eine Anzeige, die behauptet, die Kamera sei
  aus, weil das mal jemand angeordnet hat, wäre schlimmer als gar keine.

Und was in der Oberfläche auch so dasteht: **ein Software-Aus ist Komfort,
keine Garantie.** Auf einem Pi lässt sich nicht einmal ein einzelner USB-Port
stromlos schalten — alle Downstream-Ports hängen zusammen. Sicher ist nur ein
Schalter im Kabel.

## Gesten

`src/main/inputProviders/base.js` definiert die Schnittstelle, `mock.js` einen
Anbieter ohne Hardware. Der gesamte Weg lässt sich damit bauen und vorführen,
bevor entschieden ist, welcher Sensor es wird — über `POST /api/input/test`.

Das ist keine Vorsicht auf Verdacht: Ultraleaps aktuelle Software unterstützt
nur den Controller **2**. Für den ersten gibt es auf dem Pi nur ein
32-Bit-Legacy-SDK von 2014; ob das auf einem heutigen 64-Bit-System läuft,
entscheidet erst der Versuch. Ein APDS-9960 für 8 Euro wäre die Alternative —
und noch dazu keine Kamera.

Der Hub setzt drei Regeln durch, die sonst jeder Anbieter anders auslegen
würde: Sperrzeit je Geste (sonst blättert der Spiegel drei Seiten statt
einer), Mindestsicherheit (eine halb erkannte Geste wirkt wie ein Defekt), und
**kein Start bei eingeschränkter Privatsphäre** — ein Kamera-Sensor, der „nur
zuhört", ist genau das, was hier niemand will.

## Ereignis-Bus

Ein Bus, drei Transporte (lokal, IPC, WebSocket). Themen sind mit Doppelpunkt
gegliedert und mit `*` abonnierbar.

| Namensraum | Bedeutung |
| --- | --- |
| `tick:second`, `tick:minute` | gemeinsamer Takt |
| `presence:changed`, `presence:display` | Anwesenheitssensor |
| `system:*`, `config:*`, `theme:*` | Kern |
| `config:changed` | Konfiguration gespeichert |
| `system:warning` | Startwarnung, lässt die Startprobe rot werden |
| `<modul>:*` | modul-eigen |

Über den WebSocket (`/ws`) gilt: Begrüßung mit `hello` innerhalb von fünf
Sekunden, danach `subscribe` auf Themen — zugestellt wird nur Abonniertes. Die
Anmeldung ist dieselbe wie auf der HTTP-Seite. `config:changed` trägt ein
`origin` mit der Kennung des Clients, der gespeichert hat; jeder Client
ignoriert sein eigenes Echo, sonst überschreibt der eigene Speichervorgang die
gerade offene Bearbeitung.

## Die Web-Oberfläche als App

`src/webui/public/` ist eine installierbare PWA. Zwei Regeln, die dabei
wichtiger sind als alles andere:

* **Bei jeder Änderung an einer Shell-Datei `VERSION` in `sw.js` erhöhen.** Es
  gibt keinen Build-Schritt, der das tut. Ohne Erhöhung bekommen installierte
  Geräte die alte Fassung — besonders heimtückisch nach einem Update über die
  Oberfläche, weil die App dann neu startet und trotzdem die alte Hülle lädt.
* **Der Service Worker fasst `/api/` nicht an.** Ein zwischengespeicherter
  Konfigurationsstand wäre schlimmer als gar keine Offline-Fähigkeit: man sähe
  einen Zustand, den es nicht mehr gibt, und schriebe ihn womöglich zurück.
  Offline-Daten leben in der App-Schicht und sind dort als solche
  gekennzeichnet. Ein Test wacht darüber.

Ebenfalls per Test abgesichert: dass nichts von einem fremden Server geladen
wird (SortableJS liegt unter `vendor/`), dass jede Datei aus `SHELL_ASSETS`
existiert, und dass der Worker nicht ungefragt übernimmt — ein Wechsel mitten
in einer offenen Bearbeitung würde sie verwerfen.

Icons erzeugt `npm run icons:build` — direkt in einen Pixelpuffer gezeichnet
und mit `zlib` als PNG geschrieben, ohne Bildbibliothek. `sharp` oder
ImageMagick wären eine native Abhängigkeit, die auf dem Pi übersetzt werden
müsste, für etwas, das sich praktisch nie ändert.

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
