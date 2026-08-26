var VaultBridgeCore;
var VaultBridge;

function log(message) {
	Zotero.debug(`Zotero Vault Bridge: ${message}`);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log(`Starting ${version}`);
	Services.scriptloader.loadSubScript(rootURI + "core.js");
	Services.scriptloader.loadSubScript(rootURI + "bridge.js");
	await VaultBridge.startup({ id, version, rootURI });
}

function onMainWindowLoad() {}

function onMainWindowUnload() {}

function shutdown() {
	log("Shutting down");
	VaultBridge?.shutdown();
	VaultBridge = undefined;
	VaultBridgeCore = undefined;
}

function uninstall() {
	log("Uninstalled");
}
