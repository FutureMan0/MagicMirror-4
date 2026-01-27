# 🪞 MagicMirror⁴ (MM⁴)
### *The Next Generation of Smart Mirroring*

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Raspberry%20Pi%20%7C%20Windows-blue)](#)
[![Status](https://img.shields.io/badge/Status-Stable-green)](#)

---

## 💎 Die Vision
**MagicMirror⁴** bricht mit dem alten Konzept schwerfälliger Konfigurationsdateien. Es ist das erste Smart-Mirror-System, das konsequent auf **Benutzerfreundlichkeit**, **Hardware-Power** und **Premium-Design** setzt. Entwickelt für Enthusiasten, die mehr von ihrem Spiegel erwarten als nur Text auf schwarzem Hintergrund.

---

## 🔥 Key Features

| Feature | Beschreibung | Der MM⁴ Vorteil |
| :--- | :--- | :--- |
| **Dual-Screen Engine** | Native Unterstützung für HDMI-0 & HDMI-1. | Steuere zwei Monitore unabhängig mit nur einem Pi. |
| **Web-Config 2.0** | Vollständig interaktives Web-Interface. | Ändere Layouts via **Drag & Drop** live am Handy. |
| **One-Click Update** | In-App Systemaktualisierung via GitHub. | Updates installieren sich per Knopfdruck selbstständig. |
| **Next-Gen Design** | Glassmorphism & Canvas-Effekte. | Sieht aus wie ein High-End Produkt, nicht wie ein Skript. |
| **Auto-Kiosk** | Vollautomatische Systemoptimierung. | Kein Programmieren nötig – der Installer macht alles. |

---

## ⚡ Schnellstart (Raspberry Pi)

MM⁴ ist in weniger als 5 Minuten einsatzbereit. Kopiere diesen "Magic-Command" in dein Terminal:

```bash
# Repository klonen & Installer starten
git clone https://github.com/DEIN_USER/MagicMirror4.git && cd MagicMirror4 && chmod +x rpi-install.sh && sudo ./rpi-install.sh
```

### Was der Installer für dich tut:
1.  **Full Update:** Aktualisiert dein System & installiert Node.js LTS.
2.  **Hardware-Check:** Erkennt deine Monitore & konfiguriert die HDMI-Ports.
3.  **Kiosk-Finish:** Versteckt den Mauszeiger, deaktiviert den Standby & optimiert die GPU.
4.  **Autostart:** Richtet MM⁴ als Systemdienst ein (immer bereit nach Reboot).

---

## 🏪 Das Modul-Ökosystem

MM⁴ wächst mit deinen Bedürfnissen. Jedes Modul lässt sich über das Web-UI in Sekunden anpassen:

*   🕒 **Clock**: Modern, minimalistisch oder klassisch.
*   🌤️ **Weather**: Atemberaubende Hintergrund-Animationen passend zum Wetter.
*   📅 **WebUntis**: Deine Schulorganisation, perfekt visualisiert.
*   🎵 **Spotify**: Streaming-Status mit Cover-Art & Echtzeit-Sync.
*   👤 **Presence**: Reagiert auf dich durch Ultraschall- oder PIR-Sensoren.

---

## �️ Entwicklung & Testen

Du hast keinen Pi zur Hand? Kein Problem. MM⁴ läuft nativ auf Windows:

1.  `npm install`
2.  `npm run dev` (Öffnet Electron mit Debug-Tools)
3.  Web-Interface unter `http://localhost:3000` öffnen.

---

## 📄 Lizenz & Team

Hinter MagicMirror⁴ steht eine Vision von sauberem Code und perfektem Design. 
Lizenziert unter der **MIT-Lizenz** – bereit für deine Ideen.

---
<p align="center">
  <b>Bringe deinen Spiegel zum Leben. Mit MagicMirror⁴.</b>
</p>
