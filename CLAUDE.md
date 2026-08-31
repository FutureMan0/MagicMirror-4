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
* **Feste Schriftgrößen durchrechnen:**
  `font-size: calc(4rem * var(--mm-font-scale, 1))`. Ein `--mm-size-*`-Token
  ist der bessere Weg und braucht nichts weiter — es bringt den Faktor schon
  mit. `rem` hängt dagegen an der Wurzelschrift und erreicht der Faktor nie:
  wer ihn vergisst, baut genau die große Uhrzeit, die sich als Einzige nicht
  verstellen lässt. `em` und `%` bleiben, wie sie sind — sie erben den bereits
  skalierten Wert und würden den Faktor sonst ein zweites Mal anwenden.
  `tests/modul-darstellung.test.js` wacht darüber.
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

**Schriftgrößen über `--mm-size-*-quelle` neu belegen, nicht über
`--mm-size-*`.** Die Größen gibt es in zwei Ebenen: `-quelle` ist der
Grundwert, `--mm-size-*` das, was die Module benutzen. `main.css` belegt
`--mm-size-*` am Modulrahmen neu und rechnet dort die Schriftgröße des
einzelnen Moduls hinein. Diese Zeile steht am Element selbst und gewinnt damit
gegen jeden geerbten `:root`-Wert — auch gegen den eines Themes.

## Konfigurationsänderungen

`src/renderer/reconciler.js` vergleicht alte und neue Konfiguration und fasst
nur an, was sich geändert hat. Vorher lief jede Änderung über einen
Komplettneubau — wer die Schriftgröße der Uhr verstellte, löste damit aus, dass
das Wetter neu geladen und der Stundenplan neu abgefragt wurde.

| Änderung | Folge |
| :--- | :--- |
| Theme | nur Stylesheet tauschen |
| Rastereinstellungen | nur CSS-Variablen neu setzen |
| Modul verschoben | nur umplatzieren (Rasterposition liegt im Style, nicht in der DOM-Reihenfolge) |
| Größe, Schriftgröße | nur zwei CSS-Variablen am Rahmen setzen |
| Moduleinstellung | `onConfigChange` des Moduls entscheidet: patchen oder neu aufbauen |
| Sprache | Komplettneubau — betrifft ohnehin jedes Modul |

Ein Modul erklärt über `static patchable = [...]`, welche Schlüssel es ohne
Neuaufbau übernehmen kann. **Ohne `onConfigChange` wird neu aufgebaut** — der
sichere Weg.

### Größe und Schriftgröße je Modul

Beides steht **neben** `config`, nicht darin:

```json
{ "module": "clock", "position": "oben-links",
  "appearance": { "scale": 1.2, "fontScale": 0.9 } }
```

Warum nicht in `config`: dann entschiede `onConfigChange` des Moduls darüber —
und ohne `onConfigChange` heißt das Neuaufbau. Wer am Schriftgrößen-Regler
zieht, ließe damit die Uhr ihre Zeitzone neu holen. So ist es der Kern, der die
Werte setzt, und ein Modul muss von seiner Größe nichts wissen.

Die Größe läuft über `zoom`, nicht über `transform: scale()`: ein `transform`
ließe die Kachel ihren alten Platz belegen, und die vergrößerte Uhr läge über
dem Nachbarn. Damit ein vergrößertes Modul trotzdem in seiner Rasterfläche
bleibt, teilt `main.css` `max-height`/`max-width` durch denselben Faktor.

Beides fehlt oder steht auf 1 → der Eintrag entfällt beim Speichern. Der
Standard hat in der Datei nichts zu suchen.

Jeder Modul-Eintrag bekommt beim Laden eine feste `id`. Über den Array-Index
zu vergleichen ginge nicht: ein nach oben geschobenes Modul sähe aus wie „alle
ausgetauscht".

## Drehung

Sie liegt in `config.display.rotation` (0, 90, 180, 270) und wirkt als
**CSS-Drehung im Renderer** — nicht über `xrandr` und nicht über
`video=…,rotate=` in der `cmdline.txt`. So wirkt sie auch in der Live-Vorschau
am Handy, sie braucht keine Rechte auf dem Gerät, und sie überlebt einen
Wechsel des Anzeigeservers.

Bei 90 und 270 Grad setzt der Renderer den Inhalt in ein hochkantes Feld
(`100vh` breit, `100vw` hoch) und kippt erst dieses Feld in den liegenden
Bildspeicher. **Die Rasterkoordinaten sind damit bereits Wandkoordinaten:**
Spalte 1 ist die Spalte, die an der Wand links steht.

Daraus folgt, was der Konfigurator tut — und was er *nicht* tut:

| | |
| :--- | :--- |
| **Layout-Editor** | nimmt das Format an (hochkant bei 90/270), dreht die Leinwand aber **nicht** |
| **Live-Ansicht** | Rahmen im Format des gedrehten Panels, Inhalt aufrecht — was an der Wand steht |
| **Renderer in der Vorschau** | lässt seine eigene Drehung weg, wenn `rotate=off` in der Adresse steht |

Eine gedrehte Leinwand wäre die **zweite** Drehung auf denselben Inhalt. Wer
das im Editor nachrüsten will, hat den Fehler schon gemacht.

`screen.js` meldet jede Änderung als `mm:drehung` an alle, die sich mitdrehen —
und zwar **vor** dem Speichern: der Editor soll sich sofort drehen und nicht
erst, wenn der Server geantwortet hat.

## Einbrennschutz

`src/renderer/burnIn.js`. Ein Spiegel zeigt rund um die Uhr fast dasselbe Bild:
die Uhrzeit steht Jahr für Jahr an derselben Stelle. Auf einem OLED altern die
Leuchtstoffe dort schneller, wo sie heller leuchten — das Nachbild bleibt und
lässt sich nicht rückgängig machen.

```json
"display": {
  "burnIn": {
    "shift": true, "shiftRange": 8, "shiftIntervalMinutes": 5,
    "brightness": 1,
    "night": false, "nightBrightness": 0.4,
    "nightFrom": "23:00", "nightTo": "06:30"
  }
}
```

**Der Versatz ist ohne Angabe an.** Dieselbe Regel wie bei der Privatsphäre:
die schützende Einstellung ist die Vorgabe. Auf einem LCD schadet er nicht, auf
einem OLED entscheidet er.

Drei Dinge, an denen man sich sonst die Zähne ausbeißt:

* **Der Versatz läuft über `translate`, nicht über `transform`.** In `transform`
  sitzt bereits die Drehung, und eine zweite `transform`-Angabe würde sie
  ersetzen statt sich dazuzumischen. `translate`, `rotate` und `scale` werden
  als Einzeleigenschaften *vor* `transform` angewandt — beide bestehen
  nebeneinander.
* **Nicht über Abstände oder Positionen verschieben.** Das berechnet den Umbruch
  neu, und in den Modulen starten dabei die Endlos-Animationen der Themes wieder
  bei Frame 0 — genau das Ruckeln, das die Uhr schon einmal verursacht hat.
  `translate` läuft im Compositor.
* **Der Schritt kommt aus der Uhrzeit, nicht aus einem Zähler.** Der Spiegel
  wird nach jedem Update neu gestartet; ein Zähler finge dann wieder bei null
  an. Bei mehreren Updates am Tag stünde der Inhalt öfter auf Schritt 0 als
  irgendwo sonst — also genau die Ungleichverteilung, gegen die der Versatz
  antritt.

`.modules-grid` reserviert die Versatzweite als zusätzlichen Innenabstand,
damit nichts über den Rand geschoben wird. **Absolut platzierte Module sind
davon nicht erfasst** — wer eine Kachel auf `x: 0` setzt, verliert beim Versatz
ein paar Pixel.

Abgesenkt wird über Deckkraft und nicht über `filter: brightness()`: gegen die
schwarze Grundfläche wirkt beides gleich, aber Deckkraft kostet keine eigene
Filterstufe. Ganz dunkel wird es nie — eine Anzeige, die aussieht wie
ausgeschaltet, ist ein Defekt und keine Einstellung. Zum Abschalten gibt es
`displayPower`.

In der Vorschau wandert und dimmt nichts (die Randreserve bleibt, sonst bräche
die Vorschau anders um als der Spiegel).

## Bildschirm an und aus

`src/main/displayPower.js`, **nicht** in einem Modul. Das lag früher im
mmWave-Modul, weil dort der Anlass entstand — und verschwand mit ihm, obwohl
die Fähigkeit nichts mit dem Sensor zu tun hat. Sie wird an drei Stellen
gebraucht: Duschmodus (`shower.display: "off"`), Gesten (`display.wake`,
`display.toggle`) und jedem künftigen Sensor.

Zwei Wege nacheinander: `vcgencmd display_power`, sonst `xset dpms force`.
**Schlagen beide fehl, bleibt der gemeldete Zustand stehen** — zu behaupten,
der Bildschirm sei aus, während er leuchtet, wäre schlimmer als der Fehler.

Es gibt seit dem Wegfall von mmWave **keine native Abhängigkeit mehr**:
`serialport` ist raus, damit auch `electron-rebuild`, das `postinstall` und
die ganze ABI-Frage auf dem Pi.

### Electron steht in `dependencies`, nicht in `devDependencies`

Sieht falsch aus, ist es nicht: hier wird nichts gepackt, pm2 startet die App
mit `electron .`. Der In-App-Updater ruft `npm ci --omit=dev` — stünde
Electron unter `devDependencies`, würde ein Update über die Web-Oberfläche die
Laufzeit löschen und der Spiegel käme nicht wieder hoch. Auf dem Dev-Rechner
fällt das nie auf. `tests/dependencies.test.js` wacht darüber, und zwar für
jedes Paket, das `src/` oder `modules/` zur Laufzeit lädt.

## Auf dem Pi: Bootlogo und WLAN

Zwei Skripte, die `rpi-install.sh` als Schritt 7 und 8 aufruft. Beide sind
idempotent, legen vor der ersten Änderung eine Sicherung `*.vor-mm4` an und
lassen sich mit `--aus` zurücknehmen. Schlägt eines fehl, läuft die
Installation weiter — ein Spiegel ohne Bootlogo ist ein Spiegel, ein
abgebrochener Installer ist keiner.

### `scripts/rpi/boot-splash.sh`

Ersetzt die vier Himbeeren durch ein Plymouth-Theme mit eigenem Logo.
`scripts/build-boot-logo.mjs` erzeugt es — dasselbe Motiv wie die App-Icons,
gezeichnet in einen Pixelpuffer und mit `zlib` als PNG geschrieben. Liegt
`assets/boot/logo.png`, wird stattdessen dieses Bild genommen (`--input`);
`scripts/lib/png.mjs` liest 8-Bit-RGB und -RGBA.

**Gedreht wird das Bild, nicht der Framebuffer.** `video=…,rotate=` würde auch
X drehen — und der Spiegel dreht danach noch einmal per CSS, er stünde quer.
Der Bildspeicher bleibt liegend, das Logo darin ist vorgedreht. Die Drehung
kommt aus derselben Datei, aus der sie auch der Spiegel liest.

`cmdline.txt` ist **eine** Zeile; eine zweite macht den Pi unbootbar. Deshalb
wird sie zusammengezogen, bearbeitet und als genau eine Zeile zurückgeschrieben.
`console=tty1` wandert auf `tty3` — sonst schreiben Kernel-Meldungen über das
Logo.

### `scripts/rpi/wifi-24ghz.sh`

Nagelt das WLAN auf 2,4 GHz fest: NetworkManager über
`802-11-wireless.band bg`, ältere Systeme über `freq_list` im
`network={…}`-Block. 5 GHz ist schneller, kommt aber schlechter durch Fliesen
und ein verspiegeltes Glas; ein Gerät, das zwischen den Bändern springt, ist
schlimmer als eines auf dem schwächeren, stabilen Band.

**Wirkt erst beim nächsten Verbindungsaufbau.** Absichtlich: läuft die
Installation über SSH auf 5 GHz, risse ein sofortiges Umschalten die Sitzung
mitten im Herunterladen ab.

NetworkManager kennt keinen globalen Vorgabewert für das Band — die Einstellung
hängt an der einzelnen Verbindung. Ein später von Hand angelegtes WLAN ist
wieder frei; dann das Skript noch einmal laufen lassen.

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
| `presence:display` | Bildschirm an/aus, kommt aus `src/main/displayPower.js` |
| `presence:changed` | frei — für einen künftigen Anwesenheitssensor |
| `system:*`, `config:*`, `theme:*` | Kern |
| `config:changed` | Konfiguration gespeichert |
| `system:warning` | Startwarnung, lässt die Startprobe rot werden — meldet der Modul-Lader, wenn ein Backend nicht lädt |
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
npm run logo:build    # Bootlogo, in der Drehung dieser Anzeige
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
