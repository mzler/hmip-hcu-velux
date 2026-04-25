# Use an ARM64-compatible base image
FROM --platform=linux/arm64 ghcr.io/homematicip/alpine-node-simple:0.0.1

# Set the working directory inside the container
WORKDIR /app

# Copy package.json
COPY package*.json .

# Install the required npm packages
RUN npm install --omit=dev --no-audit

# Copy source files
COPY index.js .
COPY src/ ./src/
COPY public/ ./public/

# Persistent data directory
RUN mkdir -p /app/data

# Expose web UI port
EXPOSE 7070

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:7070/api/config || exit 1

# Set the entrypoint (HCU übergibt: pluginId, host, tokenPath als Argumente)
ENTRYPOINT ["node", "index.js"]

# Set the plugin metadata label (NACH ENTRYPOINT – wie im offiziellen Beispiel)
LABEL de.eq3.hmip.plugin.metadata=\
'{\
	"pluginId": "de.velux.kig300.bridge",\
	"issuer": "Velux KIG300 Bridge",\
	"version": "1.0.9",\
	"hcuMinVersion": "1.4.7",\
	"scope": "CLOUD",\
	"friendlyName": {\
		"de": "Velux KIG 300 Bridge",\
		"en": "Velux KIG 300 Bridge"\
	},\
	"description": {\
		"de": "Verbindet Velux Rolllaeden und Dachfenster (KIG 300) mit der Homematic IP HCU.",\
		"en": "Connects Velux shutters and skylights (KIG 300) to the Homematic IP HCU."\
	},\
	"logsEnabled": true\
}'
