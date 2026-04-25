#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-hcu-plugin.sh
#
# Baut das Docker-Image für die Homematic IP HCU (ARM64) und
# exportiert es als .tar.gz für HCUweb.
#
# Methode: docker buildx build → docker save → gzip
# (Zuverlässigster Weg für Cross-Platform-Exports)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

IMAGE_NAME="velux-kig300-bridge"
IMAGE_TAG="1.0.6"
FULL_TAG="${IMAGE_NAME}:${IMAGE_TAG}"
OUTPUT_FILE="${IMAGE_NAME}-${IMAGE_TAG}.tar.gz"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Velux KIG300 Bridge – HCU Plugin Builder      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── 1. Buildx-Builder für ARM64 vorbereiten ──────────────────────────────────
echo "▶ Prüfe Docker Buildx..."
if ! docker buildx inspect hcu-builder &>/dev/null; then
  echo "  → Erstelle ARM64-Builder 'hcu-builder'..."
  docker buildx create --name hcu-builder --platform linux/arm64 --use
else
  echo "  → Verwende vorhandenen Builder 'hcu-builder'."
  docker buildx use hcu-builder
fi

# ── 2. Image mit --load bauen (lädt ins lokale Docker-Daemon) ──────────────
# Das --load Flag ist erforderlich damit docker save danach funktioniert.
echo ""
echo "▶ Baue ARM64-Image ${FULL_TAG}..."
echo "  (Beim ersten Mal dauert dies einige Minuten)"
echo ""

docker buildx build \
  --platform linux/arm64 \
  --tag "${FULL_TAG}" \
  --load \
  .

echo ""
echo "✓ Image gebaut."

# ── 3. Image-Architektur prüfen ────────────────────────────────────────────
ARCH=$(docker inspect "${FULL_TAG}" --format='{{.Architecture}}' 2>/dev/null || echo "unbekannt")
echo "  Architektur: ${ARCH}"
if [ "${ARCH}" != "arm64" ]; then
  echo ""
  echo "⚠ WARNUNG: Image ist nicht ARM64 (${ARCH})!"
  echo "  Auf Intel-Macs: Docker Desktop → Settings → Features in Development"
  echo "  → 'Use Rosetta for x86/amd64 emulation' aktivieren"
  echo ""
fi

# ── 4. JSON-Label validieren ───────────────────────────────────────────────
echo ""
echo "▶ Prüfe Metadaten-Label..."
LABEL=$(docker inspect "${FULL_TAG}" --format='{{index .Config.Labels "de.eq3.hmip.plugin.metadata"}}' 2>/dev/null || echo "")
if [ -z "${LABEL}" ]; then
  echo "  ✗ FEHLER: Label 'de.eq3.hmip.plugin.metadata' fehlt!"
  echo "    Die HCU wird das Plugin ablehnen."
  exit 1
fi

echo "${LABEL}" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print('  ✓ JSON valide')
    print(f'  Plugin-ID: {data.get(\"pluginId\",\"?\")}')
    print(f'  Version:   {data.get(\"version\",\"?\")}')
    print(f'  Scope:     {data.get(\"scope\",\"?\")}')
except json.JSONDecodeError as e:
    print(f'  ✗ UNGÜLTIGES JSON: {e}')
    print('  HCU wird beim Hochladen hängen bleiben!')
    sys.exit(1)
" || exit 1

# ── 5. Als .tar.gz exportieren ────────────────────────────────────────────
echo ""
echo "▶ Exportiere als ${OUTPUT_FILE}..."

docker save "${FULL_TAG}" | gzip > "${OUTPUT_FILE}"

SIZE=$(du -sh "${OUTPUT_FILE}" | cut -f1)

# Minimale Größe prüfen (< 1MB = fehlerhaft)
SIZE_BYTES=$(stat -f%z "${OUTPUT_FILE}" 2>/dev/null || stat -c%s "${OUTPUT_FILE}" 2>/dev/null || echo "0")
if [ "${SIZE_BYTES}" -lt 1048576 ]; then
  echo ""
  echo "  ✗ FEHLER: Archiv nur ${SIZE} – zu klein! Export fehlgeschlagen."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✓ Fertig!                                       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Datei:  ${OUTPUT_FILE}"
echo "  Größe:  ${SIZE}"
echo ""
echo "  Installation auf der HCU:"
echo "  1. HCUweb öffnen:  http://<HCU-IP>"
echo "  2. Plugins → Plugin hochladen"
echo "  3. '${OUTPUT_FILE}' auswählen und hochladen"
echo "  4. Plugin aktivieren (Status: 'Aktiv' muss erscheinen)"
echo "  5. Plugin-Einstellungen → E-Mail + Passwort eingeben"
echo "     Alternativ Web-UI: http://<HCU-IP>:7070"
echo ""
