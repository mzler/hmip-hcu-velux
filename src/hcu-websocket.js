'use strict';

/**
 * hcu-websocket.js
 * WebSocket-Client für die Homematic IP HCU Connect API.
 *
 * Implementiert:
 * - Plugin-Registrierung
 * - Gerät-Registrierung (SHUTTER_ACTUATOR / BLIND_ACTUATOR)
 * - SET_VALUE / GET_VALUE Steuerung via Velux API
 * - ConfigTemplate: Konfigurationsfelder (E-Mail, Passwort) direkt
 *   im HCU-Plugin-Menü (HCUweb / Homematic-App) eingeben
 * - ConfigUpdate: Speichert neue Werte, löst Token-Fetch + Geräte-Sync aus
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { getSection, updateSection } = require('./storage');
const netatmo = require('./netatmo');

// ── Konstanten ────────────────────────────────────────────────────────────────
const PLUGIN_ID           = 'de.velux.kig300.bridge';
const HEARTBEAT_INTERVAL  = 30_000;
const RECONNECT_BASE_DELAY = 5_000;
const RECONNECT_MAX_DELAY  = 60_000;

// ── Zustand ───────────────────────────────────────────────────────────────────
let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let isShuttingDown = false;
let statusCallback = null;

const state = {
  connected: false,
  pluginId: null,
  registeredDevices: [],
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function send(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[HCU WS] Nachricht nicht gesendet (nicht verbunden):', message?.type);
    return;
  }
  ws.send(JSON.stringify(message));
}

// ── ConfigTemplate (HCU-Plugin-Menü) ─────────────────────────────────────────

/**
 * Antwortet auf ConfigTemplateRequest der HCU.
 * Definiert die Konfigurationsfelder, die im HCUweb / in der
 * Homematic-App unter "Plugin-Einstellungen" angezeigt werden.
 */
function sendConfigTemplate(requestId) {
  const velux = getSection('velux');

  const response = {
    pluginId: PLUGIN_ID,
    id: requestId,
    type: 'CONFIG_TEMPLATE_RESPONSE',
    body: {
      groups: {
        veluxAccount: {
          friendlyName: 'Velux-Active-Konto',
          description:  'Zugangsdaten Ihres Velux-Active-Kontos (App-Login)',
          order: 1,
        },
        advanced: {
          friendlyName: 'Erweitert',
          description:  'Optionale Felder – nur ändern falls nötig',
          order: 2,
        },
      },
      properties: {
        username: {
          friendlyName:  'E-Mail-Adresse',
          description:   'Ihre Velux-Active-E-Mail (Konto der Velux-App)',
          dataType:      'STRING',
          required:      'true',
          maximumLength: 255,
          currentValue:  velux.username || '',
          groupId:       'veluxAccount',
          order:         1,
        },
        password: {
          friendlyName:  'Passwort',
          description:   'Ihr Velux-Active-Passwort',
          dataType:      'STRING',
          required:      'true',
          maximumLength: 255,
          currentValue:  velux.password ? '••••••••' : '',
          groupId:       'veluxAccount',
          order:         2,
        },
        clientId: {
          friendlyName:  'Client ID (optional)',
          description:   'Leer lassen – App-Credentials werden automatisch verwendet',
          dataType:      'STRING',
          required:      'false',
          maximumLength: 100,
          currentValue:  velux.clientId || '',
          groupId:       'advanced',
          order:         1,
        },
        clientSecret: {
          friendlyName:  'Client Secret (optional)',
          description:   'Leer lassen – App-Credentials werden automatisch verwendet',
          dataType:      'STRING',
          required:      'false',
          maximumLength: 100,
          currentValue:  velux.clientSecret ? '••••••••' : '',
          groupId:       'advanced',
          order:         2,
        },
      },
    },
  };

  send(response);
  console.log('[HCU WS] ConfigTemplate gesendet.');
}

/**
 * Verarbeitet ConfigUpdateRequest (Nutzer hat Einstellungen gespeichert).
 * Speichert neue Werte, invalidiert Token und synchronisiert Geräte.
 */
async function handleConfigUpdate(msg) {
  const { id, body } = msg;
  const props = body?.properties ?? {};

  console.log('[HCU WS] ConfigUpdate empfangen:', Object.keys(props));

  const updates = {};
  if (props.username !== undefined) updates.username = props.username.trim();
  if (props.password !== undefined && props.password !== '••••••••') updates.password = props.password;
  if (props.clientId !== undefined) updates.clientId = props.clientId.trim();
  if (props.clientSecret !== undefined && props.clientSecret !== '••••••••') updates.clientSecret = props.clientSecret.trim();

  updateSection('velux', updates);
  // Token invalidieren
  updateSection('oauth', { accessToken: '', refreshToken: '', expiresAt: 0 });

  // Versuche Auth + Geräte-Sync
  try {
    try {
      await netatmo.fetchTokenByPassword();
    } catch (e) {
      throw new Error('Netatmo Auth Error: ' + e.message);
    }
    
    try {
      await netatmo.fetchHomesData();
    } catch (e) {
      throw new Error('Netatmo Sync Error: ' + e.message);
    }
    
    registerAllDevices();

    send({
      pluginId: PLUGIN_ID,
      id,
      type: 'CONFIG_UPDATE_RESPONSE',
      body: { status: 'APPLIED', message: 'Zugangsdaten gespeichert. Velux-Geräte wurden synchronisiert.' },
    });
  } catch (err) {
    console.error('[HCU WS] Config-Update fehlgeschlagen:', err.message);
    send({
      pluginId: PLUGIN_ID,
      id,
      type: 'CONFIG_UPDATE_RESPONSE',
      body: { status: 'FAILED', message: `Fehler: ${err.message}` },
    });
  }
}

// ── Geräte-Registrierung ──────────────────────────────────────────────────────

function buildDeviceRegistration(device) {
  const isWindow = device.type === 'NXD' || device.type === 'NXVDE';

  return {
    pluginId: PLUGIN_ID,
    id:       uuidv4(),
    type:     'DISCOVER_RESPONSE',
    body: {
      devices: [{
        deviceId:    `velux-${device.id}`,
        deviceType:  isWindow ? 'BLIND_ACTUATOR' : 'SHUTTER_ACTUATOR',
        deviceName:  device.name,
        serialNumber: device.id,
        features: isWindow
          ? ['SHUTTER_LEVEL', 'SLATS_LEVEL']
          : ['SHUTTER_LEVEL'],
      }],
    },
  };
}

function registerAllDevices() {
  const { devices } = getSection('velux');
  if (!devices || devices.length === 0) {
    console.warn('[HCU WS] Keine Velux-Geräte zum Registrieren. Bitte Geräte-Sync durchführen.');
    return;
  }

  // Alle Geräte in einer DiscoverResponse senden
  const isWindow = (d) => d.type === 'NXD' || d.type === 'NXVDE';
  const deviceList = devices.map((d) => ({
    deviceId:     `velux-${d.id}`,
    deviceType:   isWindow(d) ? 'BLIND_ACTUATOR' : 'SHUTTER_ACTUATOR',
    deviceName:   d.name,
    serialNumber: d.id,
    features:     isWindow(d) ? ['SHUTTER_LEVEL', 'SLATS_LEVEL'] : ['SHUTTER_LEVEL'],
  }));

  send({
    pluginId: PLUGIN_ID,
    id:       uuidv4(),
    type:     'DISCOVER_RESPONSE',
    body:     { devices: deviceList },
  });

  state.registeredDevices = devices.map((d) => ({
    velux:      d,
    hcuDeviceId: `velux-${d.id}`,
  }));

  console.log(`[HCU WS] ${deviceList.length} Gerät(e) bei HCU registriert.`);
  if (statusCallback) statusCallback({ type: 'devices', data: state.registeredDevices });
}

// ── Nachrichten-Handler ───────────────────────────────────────────────────────

async function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.warn('[HCU WS] Ungültige Nachricht:', raw.slice(0, 200));
    return;
  }

  const msgType = msg.type ?? msg.body?.type;
  console.log('[HCU WS] ←', msgType, msg.id ? `(${msg.id})` : '');

  switch (msgType) {
    // ── Plugin-Handshake ──────────────────────────────────────────────────
    case 'PLUGIN_REGISTERED':
      state.pluginId = msg.pluginId ?? PLUGIN_ID;
      console.log(`[HCU WS] Plugin registriert: ${state.pluginId}`);

      // Plugin-Status melden
      send({
        pluginId: PLUGIN_ID,
        id: uuidv4(),
        type: 'PLUGIN_STATE_RESPONSE',
        body: { readinessStatus: 'READY' },
      });

      // Geräte registrieren
      registerAllDevices();
      break;

    // ── Konfiguration (aus HCU-Menü) ─────────────────────────────────────
    case 'CONFIG_TEMPLATE_REQUEST':
      sendConfigTemplate(msg.id);
      break;

    case 'CONFIG_UPDATE_REQUEST':
      await handleConfigUpdate(msg);
      break;

    // ── Geräte-Discovery ──────────────────────────────────────────────────
    case 'DISCOVER_REQUEST':
      // HCU fragt nach Geräten – versuche Sync wenn noch keine vorhanden
      try {
        const { devices } = getSection('velux');
        if (!devices?.length) {
          await netatmo.fetchHomesData();
        }
        registerAllDevices();
      } catch (err) {
        console.error('[HCU WS] Discovery-Fehler:', err.message);
      }
      break;

    // ── Steuerung ─────────────────────────────────────────────────────────
    case 'CONTROL_REQUEST':
      await handleControlRequest(msg);
      break;

    // ── Plugin-State-Request ──────────────────────────────────────────────
    case 'PLUGIN_STATE_REQUEST':
      send({
        pluginId: PLUGIN_ID,
        id: msg.id,
        type: 'PLUGIN_STATE_RESPONSE',
        body: { readinessStatus: 'READY' },
      });
      break;

    case 'ERROR_RESPONSE':
      console.error('[HCU WS] Fehler von HCU:', msg);
      break;

    case 'PING':
      send({ type: 'PONG' });
      break;

    default:
      break;
  }
}

async function handleControlRequest(msg) {
  const { id, body } = msg;
  const { deviceId, feature, value } = body ?? {};

  if (feature !== 'SHUTTER_LEVEL') {
    send({
      pluginId: PLUGIN_ID, id, type: 'CONTROL_RESPONSE',
      body: { success: false, deviceId, error: { code: 'UNSUPPORTED_FEATURE', message: `Feature ${feature} nicht unterstützt.` } },
    });
    return;
  }

  const entry = state.registeredDevices.find((d) => d.hcuDeviceId === deviceId);
  if (!entry) {
    send({
      pluginId: PLUGIN_ID, id, type: 'CONTROL_RESPONSE',
      body: { success: false, deviceId, error: { code: 'UNKNOWN_DEVICE', message: `Gerät ${deviceId} unbekannt.` } },
    });
    return;
  }

  const position = Math.max(0, Math.min(100, Math.round(Number(value) * 100)));
  try {
    await netatmo.setShutterPosition(entry.velux.id, entry.velux.bridge, position);
    send({
      pluginId: PLUGIN_ID, id, type: 'CONTROL_RESPONSE',
      body: { success: true, deviceId },
    });
    console.log(`[HCU WS] ${entry.velux.name} → ${position}% ✓`);
  } catch (err) {
    send({
      pluginId: PLUGIN_ID, id, type: 'CONTROL_RESPONSE',
      body: { success: false, deviceId, error: { code: 'CONTROL_ERROR', message: err.message } },
    });
    console.error(`[HCU WS] Steuerfehler ${entry.velux.name}:`, err.message);
  }
}

// ── Verbindungsaufbau ─────────────────────────────────────────────────────────

function registerPlugin() {
  send({
    pluginId:    PLUGIN_ID,
    id:          uuidv4(),
    type:        'REGISTER_PLUGIN',
    body: {
      pluginId:    PLUGIN_ID,
      displayName: 'Velux KIG 300 Bridge',
      version:     '1.0.2',
    },
  });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.ping();
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function scheduleReconnect() {
  if (isShuttingDown || reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_DELAY * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY);
  reconnectAttempt++;
  console.log(`[HCU WS] Reconnect in ${delay / 1000}s (Versuch #${reconnectAttempt})...`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

function connect() {
  const { host, port, token } = getSection('hcu');
  if (!token) {
    console.warn('[HCU WS] Kein HCU-Token – Verbindung pausiert.');
    return;
  }

  // Im Container: immer wss auf port 9001
  const protocol = port === 9001 ? 'wss' : 'ws';
  const url = `${protocol}://${host}:${port}`;
  console.log(`[HCU WS] Verbinde mit ${url}...`);

  try {
    ws = new WebSocket(url, {
      // ── Korrekte Header laut HCU Connect API Doku ────────────────────────
      // https://github.com/homematicip/connect-api → 6.1 WebSocket connection request
      // Header: authtoken = Token aus /TOKEN-Datei
      //         plugin-id = Plugin-Identifier aus LABEL
      headers: {
        'authtoken':  token,
        'plugin-id':  PLUGIN_ID,
      },
      handshakeTimeout: 10000,
      rejectUnauthorized: false,
    });
  } catch (err) {
    console.error('[HCU WS] Verbindungsfehler:', err.message);
    scheduleReconnect();
    return;
  }


  ws.on('open', () => {
    reconnectAttempt = 0;
    state.connected = true;
    console.log('[HCU WS] Verbunden ✓');
    startHeartbeat();
    registerPlugin();
    if (statusCallback) statusCallback({ type: 'connection', data: { connected: true } });
  });

  ws.on('message', (data) => handleMessage(data.toString()));
  ws.on('pong', () => {});
  ws.on('close', (code, reason) => {
    state.connected = false;
    stopHeartbeat();
    console.warn(`[HCU WS] Getrennt (${code}): ${reason?.toString() ?? ''}`);
    if (statusCallback) statusCallback({ type: 'connection', data: { connected: false } });
    if (!isShuttingDown) scheduleReconnect();
  });
  ws.on('error', (err) => console.error('[HCU WS] Fehler:', err.message));
}

function disconnect() {
  isShuttingDown = true;
  stopHeartbeat();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.close(1000, 'Plugin stopped'); ws = null; }
}

function reconnect() {
  isShuttingDown = false;
  reconnectAttempt = 0;
  disconnect();
  setTimeout(connect, 1000);
}

function onStatus(cb) { statusCallback = cb; }
function getState()    { return { ...state }; }

module.exports = { connect, disconnect, reconnect, onStatus, getState, registerAllDevices };
