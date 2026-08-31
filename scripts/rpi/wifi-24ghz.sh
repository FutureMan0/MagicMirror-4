#!/usr/bin/env bash
#
# WLAN auf 2,4 GHz festnageln.
#
# Warum: 5 GHz ist schneller, kommt aber schlechter durch Wände - und ein
# Spiegel hängt im Bad, oft am anderen Ende der Wohnung, hinter Fliesen und
# einem verspiegelten Glas. Ein Gerät, das zwischen den Bändern hin- und
# herspringt, ist dabei schlimmer als eines, das dauerhaft auf dem schwächeren
# aber stabileren Band bleibt: bei jedem Wechsel bricht die Verbindung kurz
# ab, und genau dann steht die Web-Oberfläche nicht zur Verfügung.
#
#   sudo scripts/rpi/wifi-24ghz.sh              # festnageln
#   sudo scripts/rpi/wifi-24ghz.sh --pruefen    # nur zeigen, was gilt
#   sudo scripts/rpi/wifi-24ghz.sh --aus        # Bindung wieder lösen
#
# Wirkt beim nächsten Verbindungsaufbau. Absichtlich nicht sofort: läuft die
# Installation über SSH und die Verbindung hängt gerade an 5 GHz, würde ein
# sofortiges Umschalten mitten im Herunterladen die Sitzung abreißen.
set -euo pipefail

GRUEN='\033[0;32m'; GELB='\033[0;33m'; ROT='\033[0;31m'; AUS='\033[0m'
melde()  { echo -e "${GRUEN}$*${AUS}"; }
warne()  { echo -e "${GELB}$*${AUS}"; }
fehler() { echo -e "${ROT}$*${AUS}"; }

MODUS="${1:-an}"

if [ "$MODUS" != "--pruefen" ] && [ "$EUID" -ne 0 ]; then
  fehler "Bitte mit sudo starten."
  exit 1
fi

# Die 13 Kanäle des 2,4-GHz-Bandes in ETSI-Zählung. Kanal 14 ist nur in Japan
# erlaubt und bleibt deshalb draußen.
FREQUENZEN="2412 2417 2422 2427 2432 2437 2442 2447 2452 2457 2462 2467 2472"

GEFUNDEN=0

# --- NetworkManager (Bookworm und neuer) -----------------------------------

if command -v nmcli >/dev/null 2>&1 && systemctl is-active --quiet NetworkManager 2>/dev/null; then
  GEFUNDEN=1

  # -t -f: maschinenlesbar, sonst müsste man die Tabelle wieder auseinandernehmen.
  VERBINDUNGEN="$(nmcli -t -f UUID,TYPE,NAME connection show 2>/dev/null | awk -F: '$2 == "802-11-wireless"' || true)"

  if [ -z "$VERBINDUNGEN" ]; then
    warne "NetworkManager läuft, kennt aber keine WLAN-Verbindung."
  fi

  while IFS=: read -r uuid typ name; do
    [ -n "${uuid:-}" ] || continue

    if [ "$MODUS" = "--pruefen" ]; then
      band="$(nmcli -g 802-11-wireless.band connection show "$uuid" 2>/dev/null || true)"
      echo "  ${name:-$uuid}: band=${band:-<frei>}"
      continue
    fi

    if [ "$MODUS" = "--aus" ]; then
      nmcli connection modify "$uuid" 802-11-wireless.band "" 2>/dev/null \
        && melde "  ${name:-$uuid}: Bindung gelöst" \
        || warne "  ${name:-$uuid}: ließ sich nicht ändern"
      continue
    fi

    # bg = 2,4 GHz, a = 5 GHz. Die Namen kommen aus 802.11b/g bzw. 802.11a.
    nmcli connection modify "$uuid" 802-11-wireless.band bg 2>/dev/null \
      && melde "  ${name:-$uuid}: auf 2,4 GHz festgelegt" \
      || warne "  ${name:-$uuid}: ließ sich nicht ändern"
  done <<< "$VERBINDUNGEN"

  if [ "$MODUS" = "an" ]; then
    # NetworkManager kennt keinen globalen Vorgabewert für das Band - die
    # Einstellung hängt an der einzelnen Verbindung. Ein später von Hand
    # angelegtes WLAN ist deshalb wieder frei.
    warne "Neu angelegte WLAN-Verbindungen sind davon nicht erfasst."
    warne "Nach jedem neuen WLAN dieses Skript noch einmal laufen lassen."
  fi
fi

# --- wpa_supplicant (ältere Systeme) ---------------------------------------

for conf in /etc/wpa_supplicant/wpa_supplicant.conf /etc/wpa_supplicant/wpa_supplicant-wlan0.conf; do
  [ -f "$conf" ] || continue
  GEFUNDEN=1

  if [ "$MODUS" = "--pruefen" ]; then
    if grep -q "freq_list=" "$conf"; then
      echo "  $conf: $(grep -m1 'freq_list=' "$conf" | sed -E 's/^[[:space:]]*//')"
    else
      echo "  $conf: freq_list=<frei>"
    fi
    continue
  fi

  [ -f "$conf.vor-mm4" ] || cp "$conf" "$conf.vor-mm4"

  if [ "$MODUS" = "--aus" ]; then
    sed -i -E '/^[[:space:]]*freq_list=/d' "$conf"
    melde "  $conf: Frequenzliste entfernt"
    continue
  fi

  # In jeden network={...}-Block eine freq_list schreiben. Eine vorhandene wird
  # ersetzt, nicht ergänzt - zwei Listen im selben Block sind ein Syntaxfehler,
  # und ein wpa_supplicant, der nicht startet, heißt: kein Netz.
  #
  # [ \t] statt \s: Debians Standard-awk ist mawk, und mawk kennt \s nicht.
  # Es liest den Ausdruck dann als "beliebig viele s" - die eingerueckte
  # freq_list-Zeile bliebe stehen und stuende doppelt im Block.
  awk -v liste="$FREQUENZEN" '
    /^[ \t]*network[ \t]*=[ \t]*\{/ { imBlock = 1; print; next }
    imBlock && /^[ \t]*freq_list[ \t]*=/ { next }
    imBlock && /^[ \t]*\}/ { print "\tfreq_list=" liste; imBlock = 0; print; next }
    { print }
  ' "$conf" > "$conf.mm4-neu"

  # Erst prüfen, dann ersetzen: eine halb geschriebene Datei kostet das WLAN.
  if [ -s "$conf.mm4-neu" ]; then
    mv "$conf.mm4-neu" "$conf"
    chmod 600 "$conf"
    melde "  $conf: auf 2,4 GHz festgelegt"
  else
    rm -f "$conf.mm4-neu"
    warne "  $conf: unverändert gelassen (die Umschrift ergab eine leere Datei)"
  fi
done

if [ "$GEFUNDEN" -eq 0 ]; then
  warne "Weder NetworkManager noch wpa_supplicant gefunden - nichts zu tun."
  exit 0
fi

if [ "$MODUS" = "an" ]; then
  melde "WLAN ist auf 2,4 GHz festgelegt."
  echo "  Wirksam beim nächsten Verbindungsaufbau - also spätestens nach dem Neustart."
  echo "  Prüfen:       sudo $(dirname "$(readlink -f "$0")")/wifi-24ghz.sh --pruefen"
  echo "  Zurücknehmen: sudo $(dirname "$(readlink -f "$0")")/wifi-24ghz.sh --aus"
fi
