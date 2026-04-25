'use strict';

/**
 * storage.js
 * Persistente Datenspeicherung in einer JSON-Datei.
 * Speichert HCU-Token, Velux/Netatmo-Credentials und OAuth2-Token.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'config.json');

const DEFAULT_CONFIG = {
  hcu: {
    token: '',
    host: '127.0.0.1',
    port: 9292,
  },
  velux: {
    username: '',
    password: '',
    clientId: '',
    clientSecret: '',
    homeId: '',
    // Geräte: Array von { id, bridge, name, type }
    // type: 'NXO' (Rollladen) | 'NXVDE' (Dachfenster)
    devices: [],
  },
  oauth: {
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
  },
};

/**
 * Stellt sicher, dass das Datenverzeichnis und die Config-Datei existieren.
 */
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  }
}

/**
 * Liest die gesamte Konfiguration aus der JSON-Datei.
 * @returns {object} Konfigurationsobjekt
 */
function readConfig() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Deep merge mit Defaults, um fehlende Keys zu ergänzen
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (err) {
    console.error('[Storage] Fehler beim Lesen der Config:', err.message);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Schreibt das gesamte Konfigurationsobjekt in die JSON-Datei.
 * @param {object} config
 */
function writeConfig(config) {
  ensureDataFile();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('[Storage] Fehler beim Schreiben der Config:', err.message);
    throw err;
  }
}

/**
 * Aktualisiert nur einen Teil der Konfiguration (shallow merge auf Top-Level-Schlüssel).
 * @param {string} section  - z.B. 'hcu', 'velux', 'oauth'
 * @param {object} data     - Zu aktualisierende Felder
 */
function updateSection(section, data) {
  const config = readConfig();
  config[section] = { ...config[section], ...data };
  writeConfig(config);
  return config;
}

/**
 * Gibt eine bestimmte Sektion der Konfiguration zurück.
 * @param {string} section
 * @returns {object}
 */
function getSection(section) {
  const config = readConfig();
  return config[section] ?? {};
}

/**
 * Einfacher Deep-Merge: Defaults werden von `override` überschrieben.
 */
function deepMerge(defaults, override) {
  const result = { ...defaults };
  for (const key of Object.keys(override)) {
    if (
      typeof override[key] === 'object' &&
      override[key] !== null &&
      !Array.isArray(override[key]) &&
      typeof defaults[key] === 'object' &&
      defaults[key] !== null &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(defaults[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

module.exports = { readConfig, writeConfig, updateSection, getSection };
