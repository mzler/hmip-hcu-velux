'use strict';

/**
 * server.js
 * Express-Server auf Port 7070.
 * Stellt eine Web-Oberfläche zur Konfiguration bereit und
 * leitet Status-Events per Server-Sent Events (SSE) an den Browser.
 */

const express = require('express');
const path = require('path');
const { readConfig, updateSection, getSection } = require('./storage');
const netatmo = require('./netatmo');
const hcuWs = require('./hcu-websocket');

const PORT = 7070;
const app = express();

// ────────────────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ────────────────────────────────────────────────────────────────────────────
// SSE – Server-Sent Events für Live-Status
// ────────────────────────────────────────────────────────────────────────────

const sseClients = new Set();

/** Sendet ein Event an alle verbundenen SSE-Clients */
function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// HCU WebSocket Status-Callback einrichten
hcuWs.onStatus((event) => {
  broadcastSSE(event.type, event.data);
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // für Nginx-Proxy

  res.flushHeaders();

  // Aktuellen Status sofort senden
  const wsState = hcuWs.getState();
  res.write(`event: connection\ndata: ${JSON.stringify({ connected: wsState.connected })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// REST-API
// ────────────────────────────────────────────────────────────────────────────

/** GET /api/config – Aktuelle Konfiguration (ohne Passwörter/Tokens) */
app.get('/api/config', (req, res) => {
  const config = readConfig();
  res.json({
    hcu: {
      host: config.hcu.host,
      port: config.hcu.port,
      tokenConfigured: !!config.hcu.token,
    },
    velux: {
      username: config.velux.username,
      homeId: config.velux.homeId,
      deviceCount: config.velux.devices?.length ?? 0,
      devices: config.velux.devices ?? [],
      tokenValid:
        !!config.oauth.accessToken && Date.now() < config.oauth.expiresAt - 60_000,
    },
    wsConnected: hcuWs.getState().connected,
  });
});

/** POST /api/config/hcu – HCU-Einstellungen speichern */
app.post('/api/config/hcu', async (req, res) => {
  try {
    const { host, port, token } = req.body;
    updateSection('hcu', {
      host: host?.trim() || '127.0.0.1',
      port: parseInt(port, 10) || 9292,
      token: token?.trim() || '',
    });

    // WebSocket neu starten
    hcuWs.reconnect();

    broadcastSSE('log', { level: 'info', msg: 'HCU-Konfiguration gespeichert. Verbinde neu...' });
    res.json({ success: true, message: 'HCU-Konfiguration gespeichert.' });
  } catch (err) {
    console.error('[Server] HCU-Config Fehler:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/config/velux – Velux-Zugangsdaten speichern (nur E-Mail + Passwort) */
app.post('/api/config/velux', async (req, res) => {
  try {
    const { username, password } = req.body;
    const updates = {};
    if (username !== undefined) updates.username = username.trim();
    if (password !== undefined && password !== '••••••••') updates.password = password;
    updateSection('velux', updates);

    // Alten Token invalidieren
    updateSection('oauth', { accessToken: '', refreshToken: '', expiresAt: 0 });

    broadcastSSE('log', { level: 'info', msg: 'Velux-Zugangsdaten gespeichert.' });
    res.json({ success: true, message: 'Velux-Zugangsdaten gespeichert.' });
  } catch (err) {
    console.error('[Server] Velux-Config Fehler:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/velux/auth – Testet die Netatmo-Authentifizierung */
app.post('/api/velux/auth', async (req, res) => {
  try {
    broadcastSSE('log', { level: 'info', msg: 'Netatmo-Auth wird getestet...' });
    await netatmo.fetchTokenByPassword();
    broadcastSSE('log', { level: 'success', msg: 'Netatmo-Authentifizierung erfolgreich ✓' });
    res.json({ success: true, message: 'Authentifizierung erfolgreich.' });
  } catch (err) {
    const msg = `Auth fehlgeschlagen: ${err.message}`;
    broadcastSSE('log', { level: 'error', msg });
    res.status(400).json({ success: false, error: err.message });
  }
});

/** POST /api/velux/discover – Geräte entdecken und in Config speichern */
app.post('/api/velux/discover', async (req, res) => {
  try {
    broadcastSSE('log', { level: 'info', msg: 'Suche nach Velux-Geräten...' });
    const homes = await netatmo.fetchHomesData();
    const { devices } = getSection('velux');

    broadcastSSE('log', {
      level: 'success',
      msg: `${devices.length} Gerät(e) gefunden. Registriere bei HCU...`,
    });

    // Neu registrieren bei HCU
    hcuWs.registerAllDevices();

    broadcastSSE('devices', { devices });
    res.json({ success: true, devices, homes });
  } catch (err) {
    const msg = `Geräte-Suche fehlgeschlagen: ${err.message}`;
    broadcastSSE('log', { level: 'error', msg });
    res.status(400).json({ success: false, error: err.message });
  }
});

/** POST /api/velux/control – Manuell ein Gerät steuern (Test) */
app.post('/api/velux/control', async (req, res) => {
  try {
    const { moduleId, bridgeId, position } = req.body;
    if (!moduleId || bridgeId === undefined || position === undefined) {
      return res.status(400).json({ success: false, error: 'moduleId, bridgeId und position erforderlich.' });
    }

    await netatmo.setShutterPosition(moduleId, bridgeId, Number(position));
    broadcastSSE('log', { level: 'success', msg: `Gerät ${moduleId} → ${position}%` });
    res.json({ success: true });
  } catch (err) {
    broadcastSSE('log', { level: 'error', msg: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/velux/status – Aktuellen Status aller Geräte abrufen */
app.get('/api/velux/status', async (req, res) => {
  try {
    const status = await netatmo.fetchHomeStatus();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/hcu/status – WebSocket-Status */
app.get('/api/hcu/status', (req, res) => {
  res.json(hcuWs.getState());
});

// ────────────────────────────────────────────────────────────────────────────
// Fallback: Alle anderen Routen → index.html
// ────────────────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ────────────────────────────────────────────────────────────────────────────
// Server starten
// ────────────────────────────────────────────────────────────────────────────

function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Web-Oberfläche erreichbar unter http://0.0.0.0:${PORT}`);
  });
}

module.exports = { start, broadcastSSE };
