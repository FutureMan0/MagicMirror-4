#!/bin/bash

# MagicMirror⁴ Raspberry Pi Installer
# Installs dependencies and sets up a kiosk-style X11 session that starts MM⁴ reliably on boot.

# Colors for output
RED='\033[0-31m'
GREEN='\033[0-32m'
BLUE='\033[0-34m'
NC='\033[0m'

echo -e "${BLUE}==============================================${NC}"
echo -e "${BLUE}   MagicMirror⁴ Raspberry Pi Installer      ${NC}"
echo -e "${BLUE}==============================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root or with sudo${NC}"
  exit 1
fi

# Get the actual user (not root)
REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || true)}"
if [ -z "${REAL_USER:-}" ] || [ "$REAL_USER" = "root" ]; then
  echo -e "${RED}Konnte den Ziel-User nicht bestimmen. Bitte starte mit: sudo ./rpi-install.sh${NC}"
  exit 1
fi
USER_HOME=$(eval echo ~$REAL_USER)
INSTALL_DIR=$(dirname "$(readlink -f "$0")")

cd "$INSTALL_DIR" || exit 1

# Detect existing installation and offer "update" behavior (keep current ecosystem config)
EXISTING_INSTALL=0
if [ -d "$INSTALL_DIR/node_modules" ] || [ -f "$INSTALL_DIR/ecosystem.config.js" ] || [ -f "/etc/systemd/system/mm-kiosk.service" ]; then
  EXISTING_INSTALL=1
fi

KEEP_ECOSYSTEM=0
ASK_KEEP_ECOSYSTEM=0
if [ "$EXISTING_INSTALL" -eq 1 ] && [ -f "$INSTALL_DIR/ecosystem.config.js" ]; then
  ASK_KEEP_ECOSYSTEM=1
fi

# 1. Update System
echo -e "${GREEN}[1/7] Updating system...${NC}"
apt update && apt upgrade -y

# 2. Install Dependencies
echo -e "${GREEN}[2/7] Installing dependencies...${NC}"
apt install -y \
  curl git build-essential whiptail \
  xserver-xorg x11-xserver-utils xinit openbox unclutter \
  libnss3 libasound2 libatk-adaptor libgdk-pixbuf2.0-0 libgtk-3-0 libgbm1

# Ask update question only after whiptail is available
if [ "$ASK_KEEP_ECOSYSTEM" -eq 1 ]; then
  if whiptail --title "MagicMirror⁴ Update" --yesno "Bestehende Installation erkannt.\n\nVorhandene ecosystem.config.js beibehalten?\n\nJa = Update ohne Neu-Konfiguration\nNein = Neu konfigurieren (Backup wird erstellt)" 15 70; then
    KEEP_ECOSYSTEM=1
  fi
fi

# 3. Install Node.js (Latest LTS)
echo -e "${GREEN}[3/7] Installing Node.js...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# 4. Install Project Dependencies
echo -e "${GREEN}[4/7] Installing MagicMirror⁴ dependencies...${NC}"
sudo -u $REAL_USER npm install

# 4b. Setup .env file (optional)
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    echo -e "${GREEN}Creating .env from .env.example...${NC}"
    sudo -u $REAL_USER cp .env.example .env
fi

# 5. Setup PM2
echo -e "${GREEN}[5/7] Setting up PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi
sudo -u $REAL_USER pm2 install pm2-logrotate

# 6. Configuration Interface
# Detect connected HDMI ports WITHOUT requiring an X server (works on headless boots)
DISPLAY_COUNT=0
for status_file in /sys/class/drm/card*-HDMI-A-*/status; do
  [ -e "$status_file" ] || continue
  if grep -qi "^connected$" "$status_file"; then
    DISPLAY_COUNT=$((DISPLAY_COUNT + 1))
  fi
done
if [ "$DISPLAY_COUNT" -le 0 ]; then DISPLAY_COUNT=1; fi

if [ "$KEEP_ECOSYSTEM" -eq 1 ]; then
  echo -e "${GREEN}Keeping existing ecosystem.config.js (no reconfiguration).${NC}"
  CHOICE="keep"
else
  CHOICE=$(whiptail --title "MagicMirror⁴ Setup" --menu "Detected Displays: $DISPLAY_COUNT\nChoose your HDMI configuration:" 15 60 4 \
  "1" "One Screen (HDMI-0 only)" \
  "2" "Two Screens (HDMI-0 and HDMI-1)" 3>&1 1>&2 2>&3)
fi

# Common environment for PM2 (X11 kiosk session sets DISPLAY, but we keep it here for clarity)
COMMON_ENV="env: {
      NODE_ENV: 'production',
      DISPLAY: ':0',
      ELECTRON_OZONE_PLATFORM_HINT: 'auto'
    }"

case $CHOICE in
    keep)
        CAT_STARTUP=""
        ;;
    1)
        echo -e "${GREEN}Configuring for Single Screen (HDMI-0)...${NC}"
        CAT_STARTUP="module.exports = {
  apps: [{
    name: 'mm-main',
    script: 'npm',
    args: 'run display1',
    cwd: '$INSTALL_DIR',
    $COMMON_ENV
  }]
};"
        ;;
    2)
        echo -e "${GREEN}Configuring for Dual Screens (HDMI-0 & HDMI-1)...${NC}"
        CAT_STARTUP="module.exports = {
  apps: [
    {
      name: 'mm-hdmi-0',
      script: 'npm',
      args: 'run display1',
      cwd: '$INSTALL_DIR',
      $COMMON_ENV
    },
    {
      name: 'mm-hdmi-1',
      script: 'npm',
      args: 'run display2',
      cwd: '$INSTALL_DIR',
      $COMMON_ENV
    }
  ]
};"
        ;;
    *)
        echo -e "${RED}Invalid choice. Exiting.${NC}"
        exit 1
        ;;
esac

if [ "$CHOICE" != "keep" ]; then
  # Backup existing config if present
  if [ -f "$INSTALL_DIR/ecosystem.config.js" ]; then
    TS=$(date +"%Y%m%d-%H%M%S")
    cp "$INSTALL_DIR/ecosystem.config.js" "$INSTALL_DIR/ecosystem.config.js.bak-$TS"
    chown $REAL_USER:$REAL_USER "$INSTALL_DIR/ecosystem.config.js.bak-$TS" || true
  fi

  echo "$CAT_STARTUP" > ecosystem.config.js
  chown $REAL_USER:$REAL_USER ecosystem.config.js
fi

# 7. Setup Autostart (Kiosk X11 + pm2-runtime)
echo -e "${GREEN}[6/7] Setting up Kiosk Autostart (X11 + pm2-runtime)...${NC}"

# Install helper scripts and systemd unit
install -d "$INSTALL_DIR/scripts/rpi"
cat > "$INSTALL_DIR/scripts/rpi/mm-xsession.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

export DISPLAY="${DISPLAY:-:0}"
export NODE_ENV="${NODE_ENV:-production}"
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"

# Minimal WM (helps with focus/keyboard on some setups)
openbox-session &

# Kiosk tweaks (safe even if they fail)
xset s off || true
xset -dpms || true
xset s noblank || true
unclutter -idle 0.1 -root &

exec pm2-runtime start "$PROJECT_DIR/ecosystem.config.js" --update-env
EOF
chmod +x "$INSTALL_DIR/scripts/rpi/mm-xsession.sh"
chown $REAL_USER:$REAL_USER "$INSTALL_DIR/scripts/rpi/mm-xsession.sh"

cat > "/etc/systemd/system/mm-kiosk.service" <<EOF
[Unit]
Description=MagicMirror⁴ Kiosk (X11 + pm2-runtime)
After=network-online.target
Wants=network-online.target
Conflicts=getty@tty1.service

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$INSTALL_DIR
Environment=DISPLAY=:0
ExecStart=/usr/bin/xinit $INSTALL_DIR/scripts/rpi/mm-xsession.sh -- :0 vt1 -nolisten tcp
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

# If a previous install used `pm2 startup`, disable it to avoid Electron restarting without X/$DISPLAY.
systemctl disable --now "pm2-$REAL_USER.service" >/dev/null 2>&1 || true
systemctl disable --now "pm2-$REAL_USER" >/dev/null 2>&1 || true

systemctl disable --now getty@tty1.service >/dev/null 2>&1 || true
systemctl enable --now mm-kiosk.service

# Mark Directory as safe for Git (prevents issues with user switching)
sudo -u $REAL_USER git config --global --add safe.directory "$INSTALL_DIR"

# Kiosk mode tweaks are applied inside the X session script (mm-xsession.sh)

echo -e "${BLUE}==============================================${NC}"
echo -e "${GREEN}   Installation Complete!${NC}"
echo -e "${BLUE}==============================================${NC}"
echo -e "The MagicMirror will now start automatically on boot (systemd -> X11 kiosk)."
echo -e "Note: ${BLUE}HDMI-0${NC} is the port closer to the USB-C power input."
echo -e "You can manage the processes with: ${BLUE}pm2 list${NC} (inside the kiosk session)"
echo -e "View logs with: ${BLUE}journalctl -u mm-kiosk -f${NC} or ${BLUE}pm2 logs${NC}"
echo -e "Web Interface: ${BLUE}http://$(hostname -I | awk '{print $1}'):3000${NC}"
echo -e "${BLUE}==============================================${NC}"

