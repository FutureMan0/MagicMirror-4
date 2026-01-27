# Windows Setup & Testing

## Schnellstart für Windows Laptop

### 1. Installation

```powershell
# Node.js installieren (falls noch nicht vorhanden)
# Download von https://nodejs.org/

# Dependencies installieren
npm install
```

### 2. Konfiguration

1. **Erstelle `.env` Datei** (kopiere von `.env.example`):
```env
# API Keys (optional für Tests)
OPENWEATHERMAP_API_KEY=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# WebUntis (optional)
UNTIS_SERVER=
UNTIS_USERNAME=
UNTIS_PASSWORD=
UNTIS_SCHOOL=

# Display Settings
DEFAULT_INSTANCE=display1
CONFIG_PORT=3000

# Presence Sensor (Windows COM Port)
PRESENCE_SENSOR_PORT=COM3
PRESENCE_TIMEOUT=60000
PRESENCE_DIM_TIMEOUT=300000
```

2. **Module aktivieren** in `config/config.json`:
   - Setze `"enabled": true` für Module die du testen möchtest
   - Nur Clock-Modul benötigt keine API Keys

### 3. Starten

```powershell
# Development Mode (mit DevTools)
npm run dev

# Oder Production Mode
npm start
```

### 4. Web-Interface öffnen

Öffne im Browser: `http://localhost:3000`

## Module verwalten

### Verfügbare Module

Alle Module befinden sich im `modules/` Ordner:

- **clock** - Uhr & Datum (funktioniert ohne API)
- **weather** - Wetter (benötigt OpenWeatherMap API Key)
- **untis** - Stundenplan (benötigt WebUntis Zugangsdaten)
- **spotify** - Spotify Player (benötigt Spotify OAuth)
- **presence** - Presence Sensor (optional, funktioniert auch ohne Hardware)

### Module im Web-Interface hinzufügen

1. Öffne `http://localhost:3000`
2. Klicke auf "+ Modul hinzufügen"
3. Wähle ein Modul aus der Liste
4. Konfiguriere Position und Einstellungen
5. Speichern

### Module manuell aktivieren

Bearbeite `config/config.json`:

```json
{
  "modules": [
    {
      "module": "clock",
      "position": "top_right",
      "enabled": true,
      "config": { ... }
    },
    {
      "module": "weather",
      "position": "top_left",
      "enabled": true,  // ← Aktivieren
      "config": {
        "apiKey": "dein_key_hier"
      }
    }
  ]
}
```

## Windows-spezifische Hinweise

### COM Ports (Presence Sensor)

Auf Windows werden Serial Ports als `COM1`, `COM2`, etc. bezeichnet:
- Standard: `COM3`
- Finde verfügbare Ports im Device Manager

### Pfade

- Alle Pfade funktionieren mit Backslashes (`\`) und Forward Slashes (`/`)
- Module werden automatisch aus `modules/` geladen

### Performance

- Electron läuft auf Windows gut
- Für bessere Performance: Hardware-Beschleunigung aktivieren
- Im Dev-Modus: DevTools für Debugging

## Troubleshooting

### Module werden nicht angezeigt

1. Prüfe ob `modules/` Ordner existiert
2. Prüfe ob `module.json` in jedem Modul-Ordner vorhanden ist
3. Starte die App neu: `npm start`
4. Öffne Browser Console (F12) für Fehler

### Web-Interface lädt nicht

1. Prüfe ob Port 3000 frei ist
2. Prüfe Firewall-Einstellungen
3. Versuche `http://127.0.0.1:3000`

### Module laden nicht

1. Prüfe Browser Console (F12)
2. Prüfe Electron DevTools (im Dev-Modus)
3. Prüfe ob Module korrekt in `config.json` eingetragen sind

## Nächste Schritte

1. Teste Clock-Modul (funktioniert sofort)
2. Füge Weather-Modul hinzu (mit API Key)
3. Teste andere Module nach Bedarf
4. Passe Positionen im Web-Interface an
