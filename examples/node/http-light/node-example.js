const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const { features } = require("process");
const fs = require("fs").promises;
const http = require('http')

async function start(pluginId, host, authtokenFile) {
	const authtoken = await fs.readFile(authtokenFile, "utf8");
	const lightIp = "192.168.23.39";
	const deviceId = "myLight-1";

	const webSocket = new WebSocket("wss://" + host + ":9001", {
		rejectUnauthorized: false,
		headers: {
			"authtoken": authtoken,
			"plugin-id": pluginId
		}
	});

	function sendPluginReady(messageId) {
		const message = {
			id: messageId,
			pluginId: pluginId,
			type: "PLUGIN_STATE_RESPONSE",
			body: {
				pluginReadinessStatus: "READY"
			}
		};
		webSocket.send(JSON.stringify(message));
		console.log("Sent message:", JSON.stringify(message, null, 2));
	}

	function handleControlRequest(message) {
		var response = {
			id: message.id,
			pluginId: pluginId,
			type: "CONTROL_RESPONSE",
			body: {
				deviceId: deviceId,
				success: true
			}
		};

		const switchState = message.body.features.find(feature => feature.type === "switchState");
		const isOn = switchState ? switchState.on : false;
		const path = isOn ? "/on" : "/off";
		const url = `http://${lightIp}${path}`;

		http.get(url, (resp) => {
			console.log("Hello");
		});

		webSocket.send(JSON.stringify(response));
		console.log("Sent message:", JSON.stringify(response, null, 2));
	}

	function sendDiscoverResponse(messageId) {
		const message = {
			id: messageId,
			pluginId: pluginId,
			type: "DISCOVER_RESPONSE",
			body: {
				success: true,
				devices: [
					{
						deviceType: "LIGHT",
						deviceId: deviceId,
						firmwareVersion: "1.0.0",
						friendlyName: "ESP32 Lampe",
						modelType: "ESP32",
						features: [
							{
								type: "switchState",
								on: false
							}
						]
					}
				]
			}
		};
		webSocket.send(JSON.stringify(message));
		console.log("Sent message:", JSON.stringify(message, null, 2));
	}

	webSocket.on("open", () => {
		console.log("Connected to WebSocket");

		// send PLUGIN_STATE_RESPONSE upon startup
		sendPluginReady(uuidv4());
	});

	webSocket.on("message", (data) => {
		const message = JSON.parse(data);
		console.log("Received message:", JSON.stringify(message, null, 2));

		// send PLUGIN_STATE_RESPONSE on receiving a PLUGIN_STATE_REQUEST
		if (message.type === "PLUGIN_STATE_REQUEST") {
			sendPluginReady(message.id);
		}
		if (message.type === "DISCOVER_REQUEST") {
			sendDiscoverResponse(message.id);
		}
		if (message.type === "CONTROL_REQUEST") {
			handleControlRequest(message);
		}
	});

	webSocket.on('error', (err) => {
		console.error('WebSocket error:', err.code, err.message || err);
	});
}

// parse command line parameters
const args = process.argv.slice(2);
const pluginId = args[0];
const host = args[1];
const authtokenFile = args[2];

// start the plugin
start(pluginId, host, authtokenFile);
