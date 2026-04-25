# ─── Velux KIG 300 Bridge – HCU Connect API Plugin ───────────────────────────
# ARM64 ist Pflicht für die Homematic IP HCU.
# Offizielles Homematic-Base-Image (Alpine + Node.js).
FROM --platform=linux/arm64 ghcr.io/homematicip/alpine-node-simple:0.0.1

WORKDIR /app

# Dependencies installieren (kein lockfile nötig)
COPY package*.json ./
RUN npm install --omit=dev --no-audit

# Quellcode & Web-UI
COPY index.js ./
COPY src/ ./src/
COPY public/ ./public/

# Persistentes Konfigurations-Verzeichnis
RUN mkdir -p /app/data

# Port 7070 – HCU mappt diesen direkt durch
EXPOSE 7070

# Health-Check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:7070/api/config || exit 1

# ─── Pflicht-Metadaten-Label ─────────────────────────────────────────────────
# WICHTIG: Einzeiliges kompaktes JSON ohne Backslash-Umbrüche.
# Die HCU parst diesen Label beim Hochladen – fehlerhafte JSON-Formatierung
# führt zum "wird installiert"-Hänger.
LABEL de.eq3.hmip.plugin.metadata='{"pluginId":"de.velux.kig300.bridge","issuer":"Velux KIG300 Bridge","version":"1.0.0","hcuMinVersion":"1.4.7","scope":"CLOUD","friendlyName":{"de":"Velux KIG 300 Bridge","en":"Velux KIG 300 Bridge"},"description":{"de":"Verbindet Velux Dachfenster und Rolllaeden (KIG 300) mit der Homematic IP HCU.","en":"Connects Velux skylights and shutters (KIG 300) to the Homematic IP HCU."},"logsEnabled":true}'

CMD ["node", "index.js"]
