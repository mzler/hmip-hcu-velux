'use strict';

/**
 * index.js – Haupteinstiegspunkt
 *
 * Startet:
 * 1. Den Express-Server (Port 7070)
 * 2. Den HCU WebSocket-Client (sobald Token konfiguriert)
 *
 * Im Container-Betrieb auf der HCU:
 *   - Token aus /TOKEN lesen
 *   - WebSocket: wss://host.containers.internal:9001
 */

const fs = require('fs');
const path = require('path');
const server = require('./src/server');
const hcuWs = require('./src/hcu-websocket');
const { getSection, updateSection } = require('./src/storage');

console.log('╔══════════════════════════════════════════╗');
console.log('║   Velux KIG 300 ↔ Homematic HCU Bridge  ║');
console.log('║          Version 1.0.0                   ║');
console.log('╚══════════════════════════════════════════╝');

// ── HCU-Container-Erkennung ─────────────────────────────────────────────────
// Wenn /TOKEN existiert, läuft das Plugin auf der HCU und nutzt
// automatisch die Container-Netzwerkadresse.
const HCU_TOKEN_FILE = '/TOKEN';
const CONTAINER_WS_HOST = 'host.containers.internal';
const CONTAINER_WS_PORT = 9001;

if (fs.existsSync(HCU_TOKEN_FILE)) {
  try {
    const token = fs.readFileSync(HCU_TOKEN_FILE, 'utf8').trim();
    console.log('[Main] Laufe auf HCU – Token aus /TOKEN gelesen.');
    updateSection('hcu', {
      host: CONTAINER_WS_HOST,
      port: CONTAINER_WS_PORT,
      token,
    });
  } catch (err) {
    console.error('[Main] Fehler beim Lesen von /TOKEN:', err.message);
  }
} else {
  console.log('[Main] Lokaler Betrieb – Token aus config.json.');
}

// 1. Express-Server starten
server.start();

// 2. HCU WebSocket starten (falls Token konfiguriert)
const hcuConfig = getSection('hcu');
if (hcuConfig.token) {
  console.log(`[Main] Verbinde WebSocket mit ${hcuConfig.host}:${hcuConfig.port}...`);
  hcuWs.connect();
} else {
  console.log('[Main] Kein HCU-Token konfiguriert. Bitte im Web-UI einrichten: http://localhost:7070');
}

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('[Main] SIGTERM empfangen. Beende...');
  hcuWs.disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Main] SIGINT empfangen. Beende...');
  hcuWs.disconnect();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled Promise Rejection:', reason);
});
