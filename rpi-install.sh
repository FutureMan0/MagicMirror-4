#!/bin/bash

# MagicMirror3 Raspberry Pi Installer
# A clean, automated installer with CLI interface

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
REAL_USER=$SUDO_USER
USER_HOME=$(eval echo ~$REAL_USER)
INSTALL_DIR=$(dirname "$(readlink -f "$0")")

cd "$INSTALL_DIR" || exit 1

# 1. Update System
echo -e "${GREEN}[1/6] Updating system...${NC}"
apt update && apt upgrade -y

# 2. Install Dependencies
echo -e "${GREEN}[2/6] Installing dependencies...${NC}"
apt install -y curl git build-essential x11-xserver-utils xinit xterm libnss3 libasound2 libatk-adaptor libgdk-pixbuf2.0-0 libgtk-3-0 libgbm1 libasound2 whiptail unclutter

# 3. Install Node.js (Latest LTS)
echo -e "${GREEN}[3/6] Installing Node.js...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# 4. Install Project Dependencies
echo -e "${GREEN}[4/6] Installing MagicMirror⁴ dependencies...${NC}"
sudo -u $REAL_USER npm install

# 4b. Setup .env file
if [ ! -f ".env" ]; then
    echo -e "${GREEN}Creating .env from .env.example...${NC}"
    sudo -u $REAL_USER cp .env.example .env
fi

# 5. Setup PM2
echo -e "${GREEN}[5/6] Setting up PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi
sudo -u $REAL_USER pm2 install pm2-logrotate

# 6. Configuration Interface
# Detect connected displays
DISPLAY_COUNT=$(xrandr --current | grep " connected" | wc -l)
if [ "$DISPLAY_COUNT" -eq 0 ]; then
    # Fallback for Wayland/wlr-randr
    DISPLAY_COUNT=$(wlr-randr | grep -c "Enabled: yes" || echo "1")
fi

CHOICE=$(whiptail --title "MagicMirror⁴ Setup" --menu "Detected Displays: $DISPLAY_COUNT\nChoose your HDMI configuration:" 15 60 4 \
"1" "One Screen (HDMI-0 only)" \
"2" "Two Screens (HDMI-0 and HDMI-1)" 3>&1 1>&2 2>&3)

# Common environment for PM2
COMMON_ENV="env: {
      NODE_ENV: 'production',
      DISPLAY: ':0',
      ELECTRON_OZONE_PLATFORM_HINT: 'auto',
      XDG_RUNTIME_DIR: '/run/user/$(id -u $REAL_USER)'
    }"

case $CHOICE in
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

echo "$CAT_STARTUP" > ecosystem.config.js
chown $REAL_USER:$REAL_USER ecosystem.config.js

# Setup Autostart
echo -e "${GREEN}Setting up Autostart...${NC}"
# Generate PM2 startup command
STARTUP_CMD=$(sudo -u $REAL_USER pm2 startup | grep "sudo env" | head -n 1)
eval $STARTUP_CMD

# Start the apps
sudo -u $REAL_USER pm2 start ecosystem.config.js
sudo -u $REAL_USER pm2 save

# Mark Directory as safe for Git (prevents issues with user switching)
sudo -u $REAL_USER git config --global --add safe.directory "$INSTALL_DIR"

# Kiosk Mode Tweaks (Disable screen blanking)
echo -e "${GREEN}Applying Kiosk mode optimizations...${NC}"

# For X11
if [ -f "/etc/xdg/lxsession/LXDE-pi/autostart" ]; then
    sed -i 's/@xscreensaver -no-splash/ #@xscreensaver -no-splash/g' /etc/xdg/lxsession/LXDE-pi/autostart
    echo "@xset s off" >> /etc/xdg/lxsession/LXDE-pi/autostart
    echo "@xset -dpms" >> /etc/xdg/lxsession/LXDE-pi/autostart
    echo "@xset s noblank" >> /etc/xdg/lxsession/LXDE-pi/autostart
    echo "@unclutter -idle 0.1 -root" >> /etc/xdg/lxsession/LXDE-pi/autostart
fi

# For Wayland (Bookworm)
WAYFIRE_CONFIG="$USER_HOME/.config/wayfire.config"
if [ -f "$WAYFIRE_CONFIG" ]; then
    if ! grep -q "\[idle\]" "$WAYFIRE_CONFIG"; then
        echo -e "\n[idle]\ndpms_timeout = 0\nscreensaver_timeout = 0" >> "$WAYFIRE_CONFIG"
    else
        sed -i '/\[idle\]/!b;n;c\dpms_timeout = 0\nscreensaver_timeout = 0' "$WAYFIRE_CONFIG"
    fi
fi

echo -e "${BLUE}==============================================${NC}"
echo -e "${GREEN}   Installation Complete!${NC}"
echo -e "${BLUE}==============================================${NC}"
echo -e "The MagicMirror will now start automatically on boot."
echo -e "Note: ${BLUE}HDMI-0${NC} is the port closer to the USB-C power input."
echo -e "You can manage the processes with: ${BLUE}pm2 list${NC}"
echo -e "View logs with: ${BLUE}pm2 logs${NC}"
echo -e "Web Interface: ${BLUE}http://$(hostname -I | awk '{print $1}'):3000${NC}"
echo -e "${BLUE}==============================================${NC}"

