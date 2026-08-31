#!/usr/bin/env bash
#
# Eigenes Bootlogo statt der vier Himbeeren - in der Drehung der Anzeige.
#
# Gedreht wird das BILD, nicht der Framebuffer. Ein per video=...,rotate=
# gedrehter Framebuffer würde auch X drehen, und der Spiegel dreht danach noch
# einmal per CSS - er stünde quer. Der Bildspeicher bleibt deshalb liegend und
# das Logo darin ist vorgedreht.
#
#   sudo scripts/rpi/boot-splash.sh              # einrichten
#   sudo scripts/rpi/boot-splash.sh --aus        # zurück auf den Auslieferungszustand
#
# Vor der ersten Änderung entstehen cmdline.txt.vor-mm4 und config.txt.vor-mm4.
# --aus spielt genau diese zurück.
set -euo pipefail

GRUEN='\033[0;32m'; GELB='\033[0;33m'; ROT='\033[0;31m'; AUS='\033[0m'
melde()  { echo -e "${GRUEN}$*${AUS}"; }
warne()  { echo -e "${GELB}$*${AUS}"; }
fehler() { echo -e "${ROT}$*${AUS}"; }

if [ "$EUID" -ne 0 ]; then
  fehler "Bitte mit sudo starten."
  exit 1
fi

PROJEKT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THEME_DIR="/usr/share/plymouth/themes/mm4"
INSTANZ="${MM_INSTANCE:-display1}"

# Bookworm legt die Startdateien nach /boot/firmware, ältere Systeme nach /boot.
if [ -f /boot/firmware/cmdline.txt ]; then
  BOOT=/boot/firmware
elif [ -f /boot/cmdline.txt ]; then
  BOOT=/boot
else
  warne "Weder /boot/firmware/cmdline.txt noch /boot/cmdline.txt - kein Raspberry Pi?"
  warne "Das Bootlogo wird übersprungen."
  exit 0
fi

CMDLINE="$BOOT/cmdline.txt"
CONFIG="$BOOT/config.txt"

# --- Zurücknehmen ----------------------------------------------------------

if [ "${1:-}" = "--aus" ]; then
  for datei in "$CMDLINE" "$CONFIG"; do
    if [ -f "$datei.vor-mm4" ]; then
      cp "$datei.vor-mm4" "$datei"
      melde "$datei zurückgespielt."
    else
      warne "Keine Sicherung für $datei - unverändert gelassen."
    fi
  done

  if command -v plymouth-set-default-theme >/dev/null 2>&1; then
    # Auf ein Theme zurück, das es sicher gibt. Gibt es keins, bleibt es dabei.
    plymouth-set-default-theme -R pix >/dev/null 2>&1 \
      || plymouth-set-default-theme -R text >/dev/null 2>&1 \
      || true
  fi
  rm -rf "$THEME_DIR"
  melde "Bootlogo entfernt."
  exit 0
fi

# --- Plymouth --------------------------------------------------------------

if ! command -v plymouth-set-default-theme >/dev/null 2>&1; then
  melde "Plymouth wird nachinstalliert ..."
  apt-get install -y plymouth plymouth-themes >/dev/null || {
    warne "Plymouth ließ sich nicht installieren - ohne es gibt es kein Bootlogo."
    warne "Der Rest der Installation läuft weiter."
    exit 0
  }
fi

# --- Das Logo --------------------------------------------------------------

DREHUNG="$(node -e '
  const fs = require("fs");
  const dateien = [
    process.argv[1] + "/config/instances/" + process.argv[2] + ".json",
    process.argv[1] + "/config/config.json"
  ];
  for (const datei of dateien) {
    try {
      const grad = Number(JSON.parse(fs.readFileSync(datei, "utf8"))?.display?.rotation);
      if ([0, 90, 180, 270].includes(grad)) { console.log(grad); process.exit(0); }
    } catch {}
  }
  console.log(0);
' "$PROJEKT" "$INSTANZ" 2>/dev/null || echo 0)"

melde "Bootlogo für Drehung ${DREHUNG}° ..."
install -d "$THEME_DIR"

# Ein mitgebrachtes Logo hat Vorrang. So lässt sich ein eigenes Bild einsetzen,
# ohne dieses Skript anzufassen: assets/boot/logo.png hinlegen, neu einrichten.
EIGENES="$PROJEKT/assets/boot/logo.png"
if [ -f "$EIGENES" ]; then
  node "$PROJEKT/scripts/build-boot-logo.mjs" \
    --input "$EIGENES" --rotate "$DREHUNG" --out "$THEME_DIR/logo.png"
else
  # 900 Pixel breit: das Logo tragt jetzt den Schriftzug "MAGIC MIRROR4 OS",
  # und bei 512 waere die Schrift auf einem 1920er Panel kaum zu lesen.
  node "$PROJEKT/scripts/build-boot-logo.mjs" \
    --rotate "$DREHUNG" --size 900 --out "$THEME_DIR/logo.png"
fi

cat > "$THEME_DIR/mm4.plymouth" <<'EOF'
[Plymouth Theme]
Name=MagicMirror4
Description=MagicMirror4 Bootlogo
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/mm4
ScriptFile=/usr/share/plymouth/themes/mm4/mm4.script
EOF

# Das Logo liegt mittig auf der Hintergrundfarbe des Spiegels (--mm-color-bg).
# Mehr braucht es nicht: eine Fortschrittsanzeige beim Hochfahren eines
# Spiegels sähe niemand, weil niemand davorsteht.
cat > "$THEME_DIR/mm4.script" <<'EOF'
Window.SetBackgroundTopColor(0.02, 0.03, 0.05);
Window.SetBackgroundBottomColor(0.02, 0.03, 0.05);

logo.image = Image("logo.png");
logo.sprite = Sprite(logo.image);
logo.sprite.SetX(Window.GetWidth()  / 2 - logo.image.GetWidth()  / 2);
logo.sprite.SetY(Window.GetHeight() / 2 - logo.image.GetHeight() / 2);

fun refresh_callback() { }
Plymouth.SetRefreshFunction(refresh_callback);

# Eine Passwortabfrage kann es hier nicht geben - die Platte ist nicht
# verschluesselt. Die Rueckrufe bleiben trotzdem stehen: ohne sie bliebe der
# Bildschirm bei einer unerwarteten Abfrage schwarz.
fun display_normal_callback() { }
Plymouth.SetDisplayNormalFunction(display_normal_callback);
EOF

# --- Startdateien ----------------------------------------------------------

for datei in "$CMDLINE" "$CONFIG"; do
  [ -f "$datei.vor-mm4" ] || cp "$datei" "$datei.vor-mm4"
done

# config.txt: Regenbogen aus, Initramfs an (ohne sie laedt der Bootloader das
# Plymouth-Theme nicht).
for eintrag in "disable_splash=1" "auto_initramfs=1"; do
  schluessel="${eintrag%%=*}"
  if grep -qE "^[[:space:]]*${schluessel}=" "$CONFIG"; then
    sed -i -E "s|^[[:space:]]*${schluessel}=.*|${eintrag}|" "$CONFIG"
  else
    printf '\n%s\n' "$eintrag" >> "$CONFIG"
  fi
done

# cmdline.txt ist EINE Zeile - eine zweite macht den Pi unbootbar.
zeile="$(tr -d '\n' < "$CMDLINE")"

# Die Kernel-Konsole weg von tty1: dort liegt das Logo, und Meldungen wuerden
# darueber schreiben.
zeile="${zeile//console=tty1/console=tty3}"

# Ein vorhandenes loglevel ersetzen statt ein zweites anhaengen - zwei
# loglevel in einer Zeile sind kein Fehler, aber es gewinnt das letzte, und
# welches das ist, sieht man der Zeile nicht an. Steht der richtige Wert schon
# da, bleibt er an seinem Platz: sonst wanderte er bei jedem Lauf ans Ende und
# die Datei aenderte sich, ohne dass sich etwas aenderte.
case " $zeile " in
  *" loglevel=3 "*) ;;
  *) zeile="$(printf '%s' "$zeile" | sed -E 's/(^| )loglevel=[0-9]+/\1/g') loglevel=3" ;;
esac

for wort in quiet splash logo.nologo vt.global_cursor_default=0 plymouth.ignore-serial-consoles; do
  case " $zeile " in
    *" $wort "*) ;;
    *) zeile="$zeile $wort" ;;
  esac
done

zeile="$(printf '%s' "$zeile" | tr -s ' ' | sed -E 's/^ +| +$//g')"
printf '%s\n' "$zeile" > "$CMDLINE"

# --- Übernehmen ------------------------------------------------------------

plymouth-set-default-theme mm4 >/dev/null
update-initramfs -u >/dev/null 2>&1 || warne "update-initramfs lief nicht durch - das Logo erscheint eventuell erst nach dem naechsten Update."

melde "Bootlogo eingerichtet (${DREHUNG}°)."
echo "  Sicherungen: $CMDLINE.vor-mm4, $CONFIG.vor-mm4"
echo "  Zurücknehmen: sudo $PROJEKT/scripts/rpi/boot-splash.sh --aus"
