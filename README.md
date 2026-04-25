# Velux KIG 300 ↔ Homematic IP HCU Bridge

Ein Node.js-Plugin das Velux-Rollladen und Dachfenster (über Velux Active / Netatmo-API) als virtuelle Geräte in der Homematic IP HCU registriert.

---

## Architektur

```
┌─────────────────┐    WebSocket     ┌─────────────────────┐
│  Homematic HCU  │◄────────────────►│   HCU-WS-Client     │
│  (Connect API)  │                  │   (hcu-websocket.js) │
└─────────────────┘                  └──────────┬──────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │   netatmo.js         │
                                     │   OAuth2 + setstate  │
                                     └──────────┬──────────┘
                                                │ HTTPS
                                     ┌──────────▼──────────┐
                                     │  app.velux-active.com│
                                     │  (Velux KIG 300)     │
                                     └─────────────────────┘
                                                
┌─────────────────┐    REST/SSE      ┌─────────────────────┐
│  Browser        │◄────────────────►│   server.js          │
│  (Web-UI :7070) │                  │   Express + SSE      │
└─────────────────┘                  └─────────────────────┘
```

## Datei-Struktur

```
hmip-hcu-velux/
├── index.js              # Haupteinstiegspunkt
├── package.json
├── Dockerfile
├── docker-compose.yml
├── src/
│   ├── server.js         # Express-Server (Port 7070)
│   ├── hcu-websocket.js  # HCU Connect API WebSocket-Client
│   ├── netatmo.js        # Velux Active / Netatmo OAuth2 + API
│   └── storage.js        # JSON-Persistenz
├── public/
│   └── index.html        # Web-Konfigurationsoberfläche
└── data/
    └── config.json       # Persistente Konfiguration (auto-erstellt)
```

## Schnellstart

### Mit Docker (empfohlen)

```bash
# Bauen und starten
docker compose up -d --build

# Logs
docker compose logs -f
```

### Lokal (ohne Docker)

```bash
npm install
npm start
```

Dann im Browser öffnen: **http://localhost:7070**

---

## Konfiguration

### 1. HCU-Token einrichten

1. In der Homematic App → Einstellungen → Connect API → Token generieren
2. Token in der Web-UI unter **"Homematic IP HCU"** eintragen
3. Host = IP-Adresse der HCU im lokalen Netzwerk

### 2. Velux Active / Netatmo-Zugangsdaten

> **Hinweis:** Die Velux Active API ist nicht offiziell für Dritte freigegeben.
> Die Client-ID und das Client-Secret müssen aus der Velux-Active-App extrahiert werden.

**Bekannte Client-IDs** (können sich ändern):
- Aus der Android-APK extrahierbar mit Tools wie `apktool`
- Suche in der Community: [github.com/nougad/velux-cli](https://github.com/nougad/velux-cli)

### 3. Geräte entdecken

1. Nach dem Speichern der Velux-Daten → **"Auth testen"** klicken
2. Bei Erfolg → **"Geräte suchen"** klicken
3. Gefundene Geräte werden automatisch als virtuelle Geräte bei der HCU registriert

---

## Gerätetypen in Homematic

| Velux-Typ | Homematic-Typ    | Beschreibung      |
|-----------|------------------|-------------------|
| NXO       | SHUTTER_ACTUATOR | Rollladen         |
| NXD       | BLIND_ACTUATOR   | Dachfenster       |
| NXVDE     | BLIND_ACTUATOR   | Velux Dachfenster |
| NXG       | —                | Bridge (intern)   |

## Level-Mapping

```
HCU Level   Velux Position   Zustand
    0            0%          Vollständig geschlossen
   50           50%          Halb offen
  100          100%          Vollständig geöffnet
```

---

## Persistenz

Die Konfiguration wird in `data/config.json` gespeichert und überlebt Neustarts.  
Bei Docker wird das Verzeichnis als Volume gemountet.

## Error-Handling

- **WebSocket**: Automatischer Reconnect mit exponentiellem Backoff (5s → 60s max)
- **OAuth2**: Automatisches Token-Refresh 5 Minuten vor Ablauf
- **Velux API**: Fehler werden an HCU gemeldet + im Live-Log angezeigt

---

## Sicherheitshinweise

- Das Plugin läuft im Docker-Container als Non-root-User (`bridge`)
- Passwörter und Tokens werden lokal in `data/config.json` gespeichert
- Bei `network_mode: host` hat der Container Zugriff auf das lokale Netzwerk (für HCU-Verbindung nötig)
