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

## 🧯 Troubleshooting (Raspberry Pi / PM2)

### Electron exits with: `Missing X server or $DISPLAY`
This means Electron was started **without a running X server** (often happens when PM2 starts on boot before the graphical session exists).

**Fix (recommended):** use the included installer (`rpi-install.sh`). It sets up a kiosk-style **X11 session via systemd** and starts MM⁴ *inside* that X session.

**Logs:**
- `journalctl -u mm-kiosk -f`

**If you previously used `pm2 startup`:** the installer disables the `pm2-<user>` service so it won’t restart Electron headless anymore.

## 🏪 The Module Ecosystem

MM⁴ grows with your needs. Every module can be customized in seconds via the Web UI:

*   🕒 **Clock**: Modern, minimalist, or classic.
*   🌤️ **Weather**: Stunning background animations matching the current weather.
*   📅 **WebUntis**: Your school schedule, perfectly visualized.
*   🎵 **Spotify**: Streaming status with cover art & real-time sync.

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
