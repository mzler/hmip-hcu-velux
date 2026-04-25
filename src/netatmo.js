'use strict';

/**
 * netatmo.js
 * OAuth2-Flow für Velux Active (app.velux-active.com).
 *
 * Verwendet die aus der Velux Active App extrahierten Client-Credentials
 * (Community-Standard – kein Developer-Account erforderlich).
 * Nutzer brauchen nur E-Mail + Passwort ihres Velux-Active-Kontos.
 *
 * Quelle: https://github.com/nougad/velux-cli & OpenHAB-Community
 */

const axios = require('axios');
const { updateSection, getSection } = require('./storage');

const BASE_URL  = 'https://app.velux-active.com';
const TOKEN_URL = `${BASE_URL}/oauth2/token`;
const API_BASE  = `${BASE_URL}/api`;
const SYNC_BASE = `${BASE_URL}/syncapi/v1`;

// ── Hardcodierte Velux-App-Credentials ───────────────────────────────────────
// Aus der Velux Active Android-App extrahiert (Community-Workaround).
// Falls Velux diese Credentials ändert, können sie via HCU-Config überschrieben
// werden (Felder clientId / clientSecret in config.json).
const VELUX_APP_CLIENT_ID     = '5931426da127d981e76bdd3f';
const VELUX_APP_CLIENT_SECRET = '6ae2d89d15e767ae5c56b456b452d319';

function getClientCredentials() {
  const stored = getSection('velux');
  return {
    clientId:     stored.clientId     || VELUX_APP_CLIENT_ID,
    clientSecret: stored.clientSecret || VELUX_APP_CLIENT_SECRET,
  };
}

// ── Token-Management ─────────────────────────────────────────────────────────

function isTokenValid() {
  const { accessToken, expiresAt } = getSection('oauth');
  return !!accessToken && Date.now() < expiresAt - 5 * 60 * 1000;
}

async function fetchTokenByPassword() {
  const { username, password } = getSection('velux');
  const { clientId, clientSecret } = getClientCredentials();

  if (!username || !password) {
    throw new Error('Velux E-Mail und Passwort müssen konfiguriert sein (HCU-Einstellungen oder Web-UI).');
  }

  const params = new URLSearchParams({
    grant_type:    'password',
    client_id:     clientId,
    client_secret: clientSecret,
    username,
    password,
    user_prefix:   'velux',
  });

  console.log('[Netatmo] Hole Access-Token (Password Grant)...');
  let response;
  try {
    response = await axios.post(TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
  } catch (err) {
    const apiError = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Token-Request fehlgeschlagen: ${apiError}`);
  }

  const { access_token, refresh_token, expires_in } = response.data;
  const expiresAt = Date.now() + expires_in * 1000;
  updateSection('oauth', { accessToken: access_token, refreshToken: refresh_token, expiresAt });
  console.log(`[Netatmo] Token erhalten, gültig bis ${new Date(expiresAt).toISOString()}`);
  return access_token;
}

async function refreshAccessToken() {
  const { refreshToken } = getSection('oauth');
  const { clientId, clientSecret } = getClientCredentials();

  if (!refreshToken) return fetchTokenByPassword();

  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await axios.post(TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = Date.now() + expires_in * 1000;
    updateSection('oauth', { accessToken: access_token, refreshToken: refresh_token, expiresAt });
    console.log(`[Netatmo] Token erneuert, gültig bis ${new Date(expiresAt).toISOString()}`);
    return access_token;
  } catch (err) {
    console.warn('[Netatmo] Refresh fehlgeschlagen, versuche Password-Grant:', err.message);
    return fetchTokenByPassword();
  }
}

async function getValidToken() {
  return isTokenValid() ? getSection('oauth').accessToken : refreshAccessToken();
}

// ── API-Calls ────────────────────────────────────────────────────────────────

async function fetchHomesData() {
  const token = await getValidToken();
  // Velux API throws 500 if the brackets in [NXG] are URL-encoded (%5B...%5D).
  // We must bypass URLSearchParams and construct the raw string exactly as curl does.
  const payload = `access_token=${token}&gateway_types=[NXG]`;

  let response;
  try {
    response = await axios.post(`${API_BASE}/homesdata`, payload, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
  } catch (err) {
    const apiError = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`HomesData-Request fehlgeschlagen: ${apiError}`);
  }

  const homes = response.data?.body?.homes ?? [];
  console.log(`[Netatmo] ${homes.length} Home(s) gefunden.`);

  const devices = [];
  for (const home of homes) {
    if (!getSection('velux').homeId) updateSection('velux', { homeId: home.id });
    for (const module of home.modules ?? []) {
      devices.push({
        id:     module.id,
        bridge: module.bridge   ?? '',
        name:   module.name     ?? `Velux ${module.id}`,
        type:   module.type     ?? 'UNKNOWN',
        roomId: module.room_id  ?? '',
      });
    }
  }

  const velux = getSection('velux');
  updateSection('velux', { ...velux, devices });
  return homes;
}

async function fetchHomeStatus() {
  const token = await getValidToken();
  const { homeId } = getSection('velux');
  if (!homeId) throw new Error('homeId nicht konfiguriert. Erst fetchHomesData() aufrufen.');

  const params = new URLSearchParams({ access_token: token, home_id: homeId });
  const response = await axios.post(`${API_BASE}/homestatus`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  return response.data?.body ?? {};
}

async function setShutterPosition(moduleId, bridgeId, targetPosition) {
  const token = await getValidToken();
  const { homeId } = getSection('velux');
  if (!homeId) throw new Error('homeId nicht konfiguriert.');

  const position = Math.max(0, Math.min(100, Math.round(targetPosition)));
  const payload = {
    home: { id: homeId, modules: [{ bridge: bridgeId, id: moduleId, target_position: position }] },
  };

  console.log(`[Netatmo] SetState: Modul ${moduleId} → Position ${position}%`);
  const response = await axios.post(`${SYNC_BASE}/setstate`, payload, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  if (response.data?.status !== 'ok') throw new Error(`Velux API Fehler: ${JSON.stringify(response.data)}`);
  return response.data;
}

async function stopAllMovements(bridgeId) {
  const token = await getValidToken();
  const { homeId } = getSection('velux');
  const payload = { home: { id: homeId, modules: [{ id: bridgeId, stop_movements: 'all' }] } };
  const response = await axios.post(`${SYNC_BASE}/setstate`, payload, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return response.data;
}

module.exports = { fetchTokenByPassword, getValidToken, fetchHomesData, fetchHomeStatus, setShutterPosition, stopAllMovements };
