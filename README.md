# MagicMirror⁴

[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-cyan.svg)](https://opensource.org/licenses/MIT)
[![Plattform](https://img.shields.io/badge/Plattform-Raspberry%20Pi%204%2F5-blue)](#schnellstart-auf-dem-raspberry-pi)
[![CI](https://github.com/FutureMan0/MagicMirror-4/actions/workflows/ci.yml/badge.svg)](https://github.com/FutureMan0/MagicMirror-4/actions/workflows/ci.yml)

Ein Smart Mirror, der sich vollständig vom Handy einrichten lässt: Module
aktivieren, Kacheln verschieben, Themes wechseln, Zugangsdaten hinterlegen —
alles über eine Weboberfläche, die sich als App auf den Home-Bildschirm legen
lässt. Keine Konfigurationsdatei, die man über SSH bearbeitet.

**Kein MagicMirror²-Fork.** Wer `Module.register`, `node_helper` oder Regionen
wie `top_bar` sucht, findet sie hier nicht — MM⁴ ist eine eigene Electron-App
mit eigenem Modulsystem. Module aus dem MM²-Ökosystem laufen nicht.

---

## Inhalt

- [Schnellstart auf dem Raspberry Pi](#schnellstart-auf-dem-raspberry-pi)
- [Anmeldung](#anmeldung)
- [Als App aufs Handy](#als-app-aufs-handy)
- [Module](#module)
- [Themes](#themes)
- [Privatsphäre](#privatsphäre)
- [Spotify verbinden](#spotify-verbinden)
- [Aktualisieren](#aktualisieren)
- [Wenn etwas nicht geht](#wenn-etwas-nicht-geht)
- [Entwickeln und prüfen](#entwickeln-und-prüfen)
- [Stand der Dinge](#stand-der-dinge)

---

## Schnellstart auf dem Raspberry Pi

Vorausgesetzt: Raspberry Pi 4 oder 5, Raspberry Pi OS (64 Bit, Bookworm),
Bildschirm an HDMI.

```bash
git clone https://github.com/FutureMan0/MagicMirror-4.git
cd MagicMirror-4
chmod +x rpi-install.sh
sudo ./rpi-install.sh
```

Was der Installer tut:

1. **Node.js 22** einrichten, falls eine ältere Fassung installiert ist.
2. **Abhängigkeiten installieren** — ohne Entwicklungswerkzeuge. Das sind rund
   drei Viertel weniger Pakete; auf einer schwachen WLAN-Verbindung entscheidet
   das darüber, ob die Installation überhaupt durchläuft.
3. **Prüfen, ob Electron wirklich da ist.** Der Download der Programmdatei kann
   abbrechen, ohne dass die Installation einen Fehler meldet — dann wird sie
   nachgeholt statt eine Installation als gelungen zu melden, aus der nie ein
   Spiegel wird.
4. **Kiosk-Sitzung einrichten:** X11 über systemd, Mauszeiger aus, Standby aus,
   GPU-Beschleunigung an.
5. **Autostart** über pm2, damit der Spiegel nach einem Neustart von selbst
   hochkommt.

Es gibt **keine nativen Abhängigkeiten** — kein Übersetzen, kein
`electron-rebuild`, keine ABI-Fragen.

---

## Anmeldung

Der Konfigurations-Server ist nicht offen. Beim ersten Start erzeugt MM⁴ ein
Admin-Token und legt es als `MM_ADMIN_TOKEN` in der `.env` ab.

**Handy koppeln:**

1. `http://<pi-ip>:3000` im Browser öffnen.
2. **„Kopplung am Spiegel starten"** antippen.
3. Der Spiegel zeigt 60 Sekunden lang einen QR-Code. Scannen — oder den
   achtstelligen Code darunter abtippen.

Der Code steht ausschließlich auf dem Spiegel und geht nie über das Netzwerk.
Wer ihn lesen kann, steht im Raum: genau das ist der Nachweis. Ein gekoppeltes
Gerät bleibt 30 Tage angemeldet.

**Ausgesperrt?** Das Token aus der `.env` reicht ebenfalls — in der
Anmeldemaske unter „Stattdessen mit Token anmelden".

**Was ohne Anmeldung geht:** Anfragen von der Maschine selbst (`127.0.0.1`).
Die Module am Spiegel holen ihre Daten über HTTP von der eigenen Adresse, und
wer Zugriff auf den Pi hat, hat ohnehin eine Shell. Weitergeleitete Anfragen
gelten dabei **nicht** als lokal: geprüft wird die Adresse der Verbindung,
nicht ein `X-Forwarded-For`-Header.

**Zugangsdaten verlassen den Pi nicht.** `GET /api/config` liefert für jedes
im Manifest deklarierte Geheimnis nur `"__SET__"` — gesetzt oder nicht gesetzt,
mehr erfährt der Browser nicht.

> `MM_AUTH=off` in der `.env` schaltet die Anmeldung ab. Dann kann jeder im
> Netzwerk die Konfiguration ändern und Updates auslösen — nur als Notausgang
> gedacht.

---

## Als App aufs Handy

Die Weboberfläche ist eine installierbare PWA.

1. `http://<pi-ip>:3000` öffnen und koppeln.
2. Etwas speichern — danach fragt die App, ob sie auf den Home-Bildschirm soll.
   Auf iOS steht dort stattdessen die Anleitung über *Teilen*.
3. Ab dann startet MM⁴ im Vollbild, ohne Browser-Leiste.

Im Tab **Live** siehst du den Spiegel so, wie er gerade an der Wand aussieht —
dieselbe Anzeige, live, nicht ein Vorschaubild.

Ohne Verbindung lädt die Oberfläche weiter, zeigt den zuletzt bekannten Stand
und **sperrt dabei die Speichern-Knöpfe**. Wer offline weiterklickt, würde
sonst einen Stand überschreiben, den er nie gesehen hat.

> **Zum Offline-Betrieb:** Browser erlauben Service Worker nur über HTTPS oder
> auf `localhost`. Im Heimnetz per IP ist die Offline-Hülle deshalb inaktiv —
> installieren und alles andere funktioniert trotzdem.

---

## Module

Ein Modul ist ein Ordner unter `modules/`. MM⁴ findet ihn beim Start von
selbst; aktiviert wird er in der Weboberfläche.

| Modul | Zeigt | Braucht |
| :--- | :--- | :--- |
| **Uhr** | Zeit und Datum | — |
| **Wetter** | Aktuell und Vorhersage, mit passenden Effekten | OpenWeatherMap-Schlüssel (kostenlos) |
| **WebUntis** | Stundenplan als Wochen- oder Tagesansicht | Schule, Server, Zugangsdaten |
| **Spotify** | Laufender Titel mit Cover, steuerbar am Handy | Spotify Premium, siehe unten |
| **GitHub** | Letzte Commits, offene Pull Requests, Sterne | Repositories als `besitzer/name`; ab zwei Repositories ein Token — ohne erlaubt GitHub nur 60 Anfragen pro Stunde |
| **Gitea** | Dasselbe für Gitea oder Forgejo, dazu die Beitrags-Heatmap | Adresse der Instanz und Token; selbstsignierte Zertifikate sind erlaubt, wenn eingeschaltet |
| **Unraid** | Array, Plattentemperaturen, Parity, Docker-Container | Unraid 7, *Settings → Management Access → Developer Options* eingeschaltet, Schlüssel via `unraid-api apikey --create` |
| **Home Assistant** | Zustände ausgewählter Entitäten, am Handy schaltbar | Adresse und langlebiger Zugriffstoken (im HA-Profil ganz unten) |

Die Module mit fremder Schnittstelle bauen auf demselben Fundament:
Zwischenspeicher auf Platte, wachsender Abstand bei Fehlern, ein Abruf für alle
Anzeigen. Nach einem Neustart steht deshalb sofort etwas da, statt minutenlang
nichts. Bei einem Ausfall bleibt der letzte bekannte Stand sichtbar — sichtbar
gekennzeichnet als *„Nicht erreichbar — zeigt den Stand von vor 12 min"*.

Jedes dieser Module hat einen **Verbindungstest**, der nicht nur „geht/geht
nicht" sagt: Unraid nennt die verfügbaren Abschnitte (das GraphQL-Schema
unterscheidet sich je Version), Home Assistant nennt Entitäten, die es nicht
findet — ein Tippfehler in einer Kennung ist der häufigste Grund dafür, dass
nichts angezeigt wird.

**Fehlermeldungen sind Sätze, keine Ausgaben.** Was am Spiegel steht, heißt
„Keine Verbindung" oder „Zugangsdaten abgelehnt". Die technische Meldung geht
in die Konsole, wo sie hingehört.

### Schalten mit Home Assistant

Am Spiegel sind die Kacheln **schreibgeschützt** — er ist kein Touchscreen, und
ein versehentlicher Griff im Vorbeigehen wäre ärgerlicher als nützlich.
Geschaltet wird am Handy, im Tab **Steuerung**.

Dafür muss *„Schalten erlauben"* ausdrücklich eingeschaltet werden. Auch dann
gelten drei Schranken, die alle greifen müssen:

1. Die Entität muss in deiner Liste stehen.
2. Ihre Gattung muss schaltbar sein — Licht, Schalter, Szene, Skript, Medien,
   Rollladen, Lüfter, Klima.
3. Der Dienst muss bekannt sein.

**Türschlösser, Alarmanlagen und `homeassistant.stop` lassen sich nicht
schalten**, auch nicht, wenn man sie einträgt. Diese Liste steht im Code, nicht
in der Konfiguration.

### Ein eigenes Modul

```
modules/mein-modul/
  module.json    Manifest: Name, Einstellungen, Geheimnisse
  index.js       läuft im Spiegel
  styles.css     optional
  backend.js     optional, läuft im Hauptprozess
```

`modules/example-hidden/` ist die vollständige Vorlage, `modules/github/` das
Beispiel für ein Modul mit fremder Schnittstelle — rund 120 Zeilen Anzeige und
100 Zeilen Backend, davon die Hälfte Kommentare. Einzelheiten stehen in
[`CLAUDE.md`](CLAUDE.md).

---

## Themes

Sechs mitgelieferte Themes, umschaltbar in den Einstellungen:

| Theme | | |
| :--- | :--- | :--- |
| **Minimal** | dunkel | Nur Typografie. Keine Flächen, keine Rahmen, keine Dauer-Animationen — und damit die sparsamste Variante. |
| **OLED Black** | dunkel | Reines Schwarz und gedämpfte Helligkeit. Auf OLED-Panels bleibt der Hintergrund unbeleuchtet und brennt nicht ein. |
| **Newspaper** | **hell** | Serifensatz mit Haarlinien statt Kästen. Wirkt wie eine gedruckte Titelseite. |
| **Nature** | dunkel | Warme Erdtöne, weiche Verläufe, Serifen-Überschriften. |
| **Glass** | dunkel | Milchglas-Flächen und weiche Schatten. |
| **Cyberpunk** | dunkel | HUD-Optik mit geschnittenen Ecken, Cyan und Gelb, Rajdhani in Versalien. |

### Ein eigenes Theme

Ein Theme belegt Design-Tokens neu — es muss die Module nicht kennen:

```
themes/mein-theme/
  theme.css     @layer theme { :root { --mm-color-accent: ...; } }
  theme.json    { "name": "Mein Theme", "mode": "dark", "description": "..." }
```

Der Ordner genügt; die Auswahl in der Weboberfläche wird aus `themes/` gelesen.
Sämtliche Tokens stehen in `src/renderer/styles/tokens.css`.

Drei Dinge, die den Unterschied machen:

* **Kein `!important` nötig.** Modul-CSS liegt in `@layer module`, Themes in
  `@layer theme` — die Layer-Reihenfolge schlägt Spezifität und
  Quellreihenfolge. Die erste Fassung des Cyberpunk-Themes brauchte dafür noch
  21 `!important`.
* **`npm run check:tokens`** schlägt fehl, sobald ein Modul-Stylesheet eine
  rohe Farbe enthält oder Schrift unter der Lesbarkeitsgrenze setzt. Was nicht
  über ein Token läuft, kann kein Theme umfärben — und im Standard-Theme fällt
  das niemandem auf.
* **Dekoration muss Platz für sich reservieren.** Geschnittene Ecken und
  Schrägen liegen über dem Inhalt; ohne Reserve schneiden sie Text ab.

Auf schwacher Hardware setzt MM⁴ automatisch `data-perf="low"` und schaltet
damit für **jedes** Theme Blur, Schatten und Dauer-Animationen ab.

---

## Privatsphäre

Vier Zustände, umschaltbar am Handy im Tab **Privat**:

| | |
| :--- | :--- |
| **Normal** | Alles sichtbar |
| **Gäste** | Nur Uhr und Wetter. Endet nach 30 Minuten von selbst |
| **Dusche** | Nur eine große Uhr, Sensoren aus |
| **Aus** | Anzeige komplett dunkel |

Was ausgeblendet wird, steht im Manifest jedes Moduls. **Ohne Angabe gilt ein
Modul als heikel** — neue Module sind privat, bis man sie freigibt. Ein
vergessenes Feld wäre sonst ein Datenleck.

Ausgeblendet wird über CSS, nicht durch Neuaufbau: sofort, flackerfrei, und die
Module behalten ihren Zustand. Module, die es anbieten, stellen zusätzlich ihre
Abfragen ein — ein ausgeblendeter Stundenplan, der weiter alle 15 Minuten
abgerufen wird, wäre nur halb privat.

Der Dusch-Modus wird von Hand geschaltet, am Handy oder per Geste.

> **Zu Sensoren, ehrlich:** Ein Software-Aus ist Komfort, keine Garantie. Auf
> einem Raspberry Pi lässt sich nicht einmal ein einzelner USB-Port stromlos
> schalten — alle Downstream-Ports hängen zusammen. Wenn eine Kamera im Raum
> ist, ist ein **physischer Schalter im Kabel** (ca. 8 €) die einzige
> überzeugende Abschaltung. Die Anzeige im Handy zeigt den *gemessenen*
> Zustand und meldet im Zweifel „aktiv".

---

## Spotify verbinden

Geht vollständig am Handy, in vier Schritten im Modul-Dialog:

1. **App anlegen** im Spotify-Dashboard (Name frei wählbar).
2. **Redirect URI eintragen** — steht im Dialog zum Kopieren. Sie muss exakt
   stimmen, deshalb kopieren statt abtippen.
3. **Client ID einfügen.** Ein Client Secret wird nicht gebraucht.
4. **Verbinden.**

> Spotify verlangt für eigene Apps ein **Premium-Konto**. Ohne das endet der
> Vorgang in einem 403, dessen Ursache nirgends steht.

**Warum eine fremde Rückleitungsadresse?** Spotify erlaubt seit dem 27.11.2025
nur noch `https://` oder wörtliche Loopback-Adressen als Redirect URI — die
LAN-Adresse des Pi ist damit ausgeschlossen. Die Rückleitung läuft deshalb über
eine statische HTTPS-Seite, die nichts tut außer weiterzuleiten: sie liest die
Adresse deines Spiegels aus dem `state` und schickt dich dorthin zurück. Die
Zugangsdaten selbst laufen nie über sie.

Klappt der automatische Rücksprung nicht — Chromes HTTPS-First-Mode kann
dazwischenfunken —, steht auf der Seite ein Code zum Einfügen.

---

## Aktualisieren

In der Weboberfläche unter **System → Update**. Dahinter passiert:

```
git pull --ff-only  →  npm ci --omit=dev  →  Electron prüfen  →  Neustart
```

Drei bewusste Entscheidungen:

* **`--ff-only`, kein `stash`.** Lokale Änderungen wurden früher stillschweigend
  weggestasht; wer das nicht wusste, hat sie nie wiedergefunden. Jetzt bricht
  das Update ab und sagt, was los ist.
* **`npm ci`, kein `npm install`.** `npm install` schreibt das Lockfile bei
  jeder Gelegenheit um — genau dadurch war es einmal kaputt.
* **Electron wird nachgewiesen, bevor neu gestartet wird.** `npm ci` meldet
  Erfolg, auch wenn der Download der Programmdatei abgebrochen ist. Ohne diese
  Prüfung wäre der Spiegel nach dem Neustart tot — mit einem Update, das sich
  als erfolgreich gemeldet hat.

Hat man lokal etwas geändert und will es behalten:

```bash
cd MagicMirror-4
git status                       # zeigt, worum es geht
git stash push -m "meine Änderungen"
git pull --ff-only
git stash pop
```

---

## Wenn etwas nicht geht

**Der Bildschirm bleibt schwarz, im Log steht `Missing X server or $DISPLAY`.**
Electron wurde ohne laufenden X-Server gestartet — typisch, wenn pm2 beim
Systemstart früher dran ist als die grafische Sitzung. Der mitgelieferte
Installer richtet dafür eine Kiosk-Sitzung über systemd ein und startet MM⁴
darin. Wer vorher `pm2 startup` benutzt hat: der Installer schaltet den Dienst
`pm2-<benutzer>` ab, damit er Electron nicht weiter kopflos startet.

**Logs:**

```bash
journalctl -u mm-kiosk -f    # die grafische Sitzung
pm2 logs                     # die Anwendung
```

**Module bleiben leer.** Zuerst den Verbindungstest im Modul-Dialog benutzen —
er nennt die Ursache genauer als die Anzeige am Spiegel. Häufigster Grund ist
ein Tippfehler in einer Kennung oder ein abgelaufener Token.

**Ein Modul fehlt ganz.** Steht es in `config/instances/<name>.json`? Diese
Datei **ersetzt** die Modulliste aus `config/config.json`, sie ergänzt sie
nicht. Ein Modul, das nur in der allgemeinen Konfiguration steht, erscheint auf
dieser Instanz nicht.

**Das Handy erreicht den Spiegel nicht.** Beide im selben Netz? Und läuft der
Server: `curl -s -o /dev/null -w '%{http_code}\n' http://<pi-ip>:3000/` sollte
`200` liefern.

**Alles ruckelt.** `vcgencmd measure_temp` und `vcgencmd get_throttled` prüfen —
ein gedrosselter Pi ist die häufigste Ursache. Sonst hilft ein sparsameres
Theme (Minimal oder OLED Black).

---

## Entwickeln und prüfen

Zum Entwickeln braucht es keinen Pi; Node 22 genügt.

```bash
npm ci
npm run dev            # Electron mit Entwicklerwerkzeugen
```

Die Weboberfläche liegt dann auf `http://localhost:3000`, der Spiegel selbst
auf `http://localhost:3000/mirror/` — er läuft auch im normalen Browser.

```bash
npm run verify         # Lint, Token- und Lesbarkeitsprüfung, Tests
npm run smoke          # startet die App wirklich (braucht einen Bildschirm)
npm run routes         # zeigt alle registrierten Modul-Routen
```

`npm run smoke` startet Electron mit einer Konfiguration, in der **jedes**
vorhandene Modul aktiv ist, prüft dass alle laden, und verbindet sich
anschließend als echter WebSocket-Client. In der CI läuft das über vier Themes
hinweg und auf Node 20 und 22.

---

## Stand der Dinge

Ehrlich gesagt, damit niemand falsche Erwartungen mitbringt:

**Geprüft und läuft:** Der Spiegel startet auf einem Raspberry Pi 4 unter
Electron 43, alle Module laden, der Live-Kanal überträgt Änderungen sofort,
274 Tests laufen durch — auf dem Entwicklungsrechner, in der CI und auf dem Pi
selbst. Zugangsdaten verlassen das Gerät nachweislich nicht: geprüft mit
echten Schlüsseln auf echter Hardware.

**Bekannte Fehler:** Das Wetter-Modul holt seine Daten noch selbst statt über
ein Backend. Am Spiegel funktioniert es; in der Live-Ansicht am Handy bleibt
es leer, weil der Schlüssel dorthin bewusst nicht ausgeliefert wird. Ein
Backend dafür steht aus.

**Noch nicht fertig:** Die Gestensteuerung hat bisher nur einen Anbieter ohne
Hardware; ein echter Sensor ist nicht angebunden. Der Visual Editor ist eine
Vorschau — bei Layoutproblemen in den Einstellungen zurück auf **Klassisches
Raster**. Der Dusch-Modus schaltet sich nicht selbst ein.

**Nicht ausprobiert:** die Weboberfläche auf einem echten Handy. Sie ist als
PWA gebaut und getestet, aber niemand hat sie bisher installiert.

Getestet wurde auf Raspberry Pi OS Bookworm (64 Bit) auf einem Pi 4. Andere
Kombinationen sollten funktionieren, sind aber nicht ausprobiert.

---

## Lizenz

MIT.
