# 🪞 MagicMirror³ (Next Gen)

[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://GitHub.com/Naereen/StrapDown.js/graphs/commit-activity)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-Raspberry%20Pi%20%7C%20Windows%20%7C%20Linux-blue)](#)

**MagicMirror³** ist ein modulares, hochmodernes Smart-Mirror-System, das von Grund auf für **Multi-Display-Setups** und eine **intuitive Benutzererfahrung** entwickelt wurde. Schluss mit komplexen Konfigurationsdateien – willkommen in der Zukunft des Smart Mirrors.

---

## ✨ Warum MagicMirror³? (USPs)

Im Gegensatz zu klassischen Open-Source-Systemen setzt MagicMirror³ neue Maßstäbe in Flexibilität und Design:

1. **🚀 Native Dual-Screen Power**: Das erste System, das nativ zwei HDMI-Ausgänge (HDMI-0 & HDMI-1) ansteuert. Ideal für große Spiegel, die zwei Monitore nutzen, um verschiedene Informationen gleichzeitig darzustellen.
2. **📱 Modern Web-GUI & Live-Preview**: Keine manuelle Bearbeitung von `.js`-Dateien mehr. Konfiguriere deinen Spiegel bequem vom Handy oder Laptop aus. Verschiebe Module via **Drag & Drop** und sieh die Änderungen sofort in der Live-Vorschau.
3. **🛠️ One-Line Installer**: Ein intelligenter CLI-Installer übernimmt alles – von Node.js-Setup über Kiosk-Modus und Cursor-Hiding bis hin zur System-Optimierung für Raspberry Pi OS (inkl. Wayland/Bookworm Support).
4. **🔄 Smart Auto-Update**: Bleibe immer aktuell. Das System prüft selbstständig auf GitHub-Updates und installiert diese mit einem Klick direkt über das Web-Interface – inklusive automatischem Prozess-Neustart.
5. **💎 Premium Aesthetics**: Ein Designsystem basierend auf Glassmorphism, flüssigen Animationen und einem intelligenten Dark-Mode, das nicht wie ein Bastelprojekt, sondern wie ein High-End-Produkt aussieht.

---

## 🛠️ Installation (Raspberry Pi)

Wir haben den Installationsprozess so sauber wie möglich gestaltet. Kopiere einfach diesen Befehl in dein Terminal:

```bash
# Repository klonen
git clone https://github.com/DEIN_USER/MagicMirror3.git
cd MagicMirror3

# Installer starten
chmod +x rpi-install.sh
sudo ./rpi-install.sh
```

**Der Installer erledigt:**
*   System-Updates & Grafik-Abhängigkeiten
*   Node.js (LTS) & PM2 (Prozess-Manager)
*   HDMI-Port Erkennung & Konfiguration
*   Automatischer Start nach Boot
*   Kiosk-Modus Tweaks (Cursor weg, Stromsparen aus)

---

## 🏪 Module & App Store

MagicMirror³ kommt mit einer wachsenden Liste an Premium-Modulen:

*   **🕐 Clock**: Elegante Zeitanzeige mit verschiedenen Layouts.
*   **🌤️ Weather**: Animierte Wetter-Effekte (Regen, Schnee, Sonne) direkt auf dem Spiegel-Glas.
*   **📅 WebUntis**: Vollständige Integration deines Stundenplans (ideal für Schulen/Unis).
*   **🎵 Spotify**: Real-time Player mit Cover-Art und Spotify-Code Support.
*   **👤 Presence**: UART-Sensor Support für automatisches Dimmen bei Abwesenheit.

---

## 💻 Entwicklung & Windows Support

MagicMirror³ läuft hervorragend auf Windows zum Testen und Entwickeln:

```bash
npm install
npm run dev   # Startet mit DevTools
```

---

## 📄 Lizenz

Dieses Projekt ist unter der **MIT-Lizenz** lizenziert - siehe die [LICENSE](LICENSE) Datei für Details.

---

<p align="center">
  Entwickelt mit ❤️ für die Smart Home Community.
</p>
