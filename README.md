# 🪞 MagicMirror⁴ (MM⁴)
### *The Next Generation of Smart Mirroring*

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Raspberry%20Pi%20%7C%20Windows-blue)](#)
[![Status](https://img.shields.io/badge/Status-Stable-green)](#)

---

## 💎 The Vision
**MagicMirror⁴** breaks away from the old concept of cumbersome configuration files. It is the first smart mirror system consistently designed for **user-friendliness**, **hardware power**, and **premium design**. Built for enthusiasts who expect more from their mirror than just text on a black background.

---

## 🔥 Key Features

| Feature | Description | The MM⁴ Advantage |
| :--- | :--- | :--- |
| **Dual-Screen Engine** | Native support for HDMI-0 & HDMI-1. | Control two monitors independently with a single Pi. |
| **Web-Config 2.0** | Fully interactive web interface. | Change layouts via Drag & Drop live from your phone. |
| **Visual Editor** | **Experimental** layout manager. | Move and resize modules freely in a visual canvas. |
| **One-Click Update** | In-app system updates via GitHub. | Updates install themselves automatically with one click. |
| **Next-Gen Design** | Glassmorphism & Canvas effects. | Looks like a high-end product, not like a script. |
| **Auto-Kiosk** | Fully automated system optimization. | No coding required – the installer handles everything. |

---

## 🏗️ Plug & Play Module System

MM⁴ uses a **Dynamic Module Loader**. Adding features is as easy as dropping a folder into the `modules/` directory:

*   **Auto-Scan:** MM⁴ detects new folders in the `modules/` directory automatically.
*   **Instant UI:** New modules appear immediately in the Web UI's "Store" for activation.
*   **Clean Structure:** Each module is self-contained with its own logic, styles, and settings.

---

## ⚡ Quick Start (Raspberry Pi)

MM⁴ is ready to go in less than 5 minutes. Copy this "Magic Command" into your terminal:

```bash
# Clone repository & start installer
git clone https://github.com/FutureMan0/MagicMirror-4.git && cd MagicMirror-4 && chmod +x rpi-install.sh && sudo ./rpi-install.sh
```

### What the installer does for you:
1.  **Full Update:** Updates your system & installs Node.js LTS.
2.  **Hardware Check:** Detects your monitors & configures the HDMI ports.
3.  **Kiosk Finish:** Hides the mouse cursor, disables standby & optimizes the GPU.
4.  **Autostart:** Sets up MM⁴ as a system service (always ready after reboot).

---

## 🔐 Anmeldung

Der Konfigurations-Server ist nicht mehr offen. Beim ersten Start erzeugt MM⁴ ein Admin-Token und legt es als `MM_ADMIN_TOKEN` in der `.env` ab.

**Handy koppeln:**

1. `http://<pi-ip>:3000` im Browser öffnen.
2. **„Kopplung am Spiegel starten"** antippen.
3. Der Spiegel zeigt 60 Sekunden lang einen QR-Code. Scannen — oder den achtstelligen Code darunter abtippen.

Der Code steht ausschließlich auf dem Spiegel und geht nie über das Netzwerk. Wer ihn lesen kann, steht im Raum: genau das ist der Nachweis.

Ein gekoppeltes Gerät bleibt 30 Tage angemeldet.

**Ausgesperrt?** Das Token aus der `.env` reicht ebenfalls — in der Anmeldemaske unter „Stattdessen mit Token anmelden".

**Was ohne Anmeldung geht:** Anfragen von der Maschine selbst (`127.0.0.1`). Die Module am Spiegel holen ihre Daten über HTTP von der eigenen Adresse, und wer Zugriff auf den Pi hat, hat ohnehin eine Shell.

> `MM_AUTH=off` in der `.env` schaltet die Anmeldung ab. Dann kann jeder im Netzwerk die Konfiguration ändern und Updates auslösen — nur als Notausgang gedacht.

---

## 🧯 Troubleshooting (Raspberry Pi / PM2)

### Electron exits with: `Missing X server or $DISPLAY`
This means Electron was started **without a running X server** (often happens when PM2 starts on boot before the graphical session exists).

**Fix (recommended):** use the included installer (`rpi-install.sh`). It sets up a kiosk-style **X11 session via systemd** and starts MM⁴ *inside* that X session.

**Logs:**
- `journalctl -u mm-kiosk -f`

**If you previously used `pm2 startup`:** the installer disables the `pm2-<user>` service so it won’t restart Electron headless anymore.

### Updating an existing installation (without overwriting your setup)
If `git pull` complains about local changes (e.g. `rpi-install.sh`):

```bash
cd MagicMirror-4
git status
git stash push -m "local changes"
git pull
git stash pop || true
chmod +x rpi-install.sh
sudo ./rpi-install.sh
```

## 🏪 The Module Ecosystem

MM⁴ grows with your needs. Every module can be customized in seconds via the Web UI:

*   🕒 **Clock**: Modern, minimalist, or classic.
*   🌤️ **Weather**: Stunning background animations matching the current weather.
*   📅 **WebUntis**: Your school schedule, perfectly visualized.
*   🎵 **Spotify**: Streaming status with cover art & real-time sync.

---

## 🎨 Themes

Sechs mitgelieferte Themes, umschaltbar in den Einstellungen der Web-Oberfläche:

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

Der Ordner genügt; die Auswahl in der Web-Oberfläche wird aus `themes/`
gelesen. Sämtliche Tokens stehen in `src/renderer/styles/tokens.css`.

Zwei Dinge, die den Unterschied machen:

* **Kein `!important` nötig.** Modul-CSS liegt in `@layer module`, Themes in
  `@layer theme` — die Layer-Reihenfolge schlägt Spezifität und
  Quellreihenfolge. Die erste Fassung des Cyberpunk-Themes brauchte dafür noch
  21 `!important`.
* **`npm run check:tokens`** schlägt fehl, sobald ein Modul-Stylesheet eine
  rohe Farbe enthält. Was nicht über ein Token läuft, kann kein Theme
  umfärben — und im Standard-Theme fällt das niemandem auf.

Auf schwacher Hardware setzt MM⁴ automatisch `data-perf="low"` und schaltet
damit für **jedes** Theme Blur, Schatten und Dauer-Animationen ab.

---

## ⚠️ Note: Visual Editor (Experimental)

The new **Visual Editor** allows for free positioning and resizing of modules. Please note:
*   **Experimental Status:** This feature is currently in preview. 
*   **Feedback:** If you encounter layout issues, please switch back to the **Classic Grid** in the Web UI settings.
*   **Mobile Info:** While it works on mobile, a tablet or desktop is recommended for complex layout changes.

---

## 🛠️ Development & Testing

Don't have a Pi on hand? No problem. MM⁴ runs natively on Windows:

1.  `npm install`
2.  `npm run dev` (Opens Electron with debug tools)
3.  Open Web Interface at `http://localhost:3000`.

---

## 📄 License & Team

Behind MagicMirror⁴ stands a vision of clean code and perfect design. 
Licensed under the **MIT License** – ready for your ideas.

---
<p align="center">
  <b>Bring your mirror to life. With MagicMirror⁴.</b>
</p>
