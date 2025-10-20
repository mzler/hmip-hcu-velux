# Use an ARM64-compatible base image
FROM --platform=linux/arm64 ghcr.io/homematicip/alpine-node-simple:0.0.1

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json .

# Install the required npm packages
RUN npm install

# Copy the executable
COPY node-example.js .

# Set the entrypoint to run the executable
ENTRYPOINT ["node", "node-example.js", "de.friedrich.niklas.vodcast", "host.containers.internal", "/TOKEN"]

# Set the plugin metadata label
LABEL de.eq3.hmip.plugin.metadata=\
'{\
	"pluginId": "de.friedrich.niklas.vodcast",\
	"issuer": "Vodcast",\
	"version": "1.0.0",\
	"hcuMinVersion": "1.4.7",\
	"scope": "LOCAL",\
	"friendlyName": {\
		"en": "Vodcast",\
		"de": "Vodcast"\
	},\
    "description": {\
        "en": "Vodcast plugin with node.js",\
        "de": "Vodcast Plugin mit node.js"\
    },\
	"logsEnabled": true\
}'