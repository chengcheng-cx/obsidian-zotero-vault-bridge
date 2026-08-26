const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceDirectory = path.resolve(__dirname, "../src");
const coreSource = fs.readFileSync(path.join(sourceDirectory, "core.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(sourceDirectory, "bridge.js"), "utf8");

function createHarness() {
	const vaultRoot = "C:\\Research\\Vault";
	const pdfPath = `${vaultRoot}\\01_Papers\\paper.pdf`;
	const preferences = new Map();
	const endpoints = {};
	let linked = false;
	let linkCalls = 0;
	let recognizeCalls = 0;

	const parent = {
		id: 2,
		key: "ITEM0001",
		itemType: "journalArticle",
		toJSON() {
			return {
				itemType: "journalArticle",
				title: "Recognized Paper",
				date: "2026",
				publicationTitle: "Test Journal",
				DOI: "10.0000/test",
				creators: [{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" }],
			};
		},
		getField() { return ""; },
		async eraseTx() {},
	};
	const attachment = {
		id: 1,
		key: "ATTACH01",
		parentID: null,
		isAttachment() { return true; },
		async getFilePath() { return pdfPath; },
		async save() {},
	};

	function fileFor(rawPath) {
		if (rawPath !== vaultRoot && rawPath !== pdfPath) {
			throw new Error("Unexpected path");
		}
		return {
			path: rawPath,
			exists() { return true; },
			normalize() {},
			isDirectory() { return rawPath === vaultRoot; },
		};
	}

	const Zotero = {
		version: "10.0.1",
		isWin: true,
		debug() {},
		logError() {},
		Prefs: {
			get(key) { return preferences.get(key); },
			set(key, value) { preferences.set(key, value); },
		},
		File: { pathToFile: fileFor },
		Server: { Endpoints: endpoints },
		Libraries: { userLibraryID: 1 },
		Attachments: {
			LINK_MODE_LINKED_FILE: 2,
			async linkFromFile() {
				linked = true;
				linkCalls += 1;
				return attachment;
			},
		},
		DB: {
			async columnQueryAsync() { return linked ? [attachment.id] : []; },
			async executeTransaction(callback) { return callback(); },
		},
		Items: {
			async getAsync(id) {
				if (id === attachment.id) return attachment;
				if (id === parent.id) return parent;
				return null;
			},
		},
		RecognizeDocument: {
			canRecognize() { return true; },
			async _recognize() {
				recognizeCalls += 1;
				return parent;
			},
		},
	};

	const context = vm.createContext({ Zotero });
	vm.runInContext(coreSource, context, { filename: "core.js" });
	vm.runInContext(bridgeSource, context, { filename: "bridge.js" });

	return {
		context,
		Zotero,
		preferences,
		vaultRoot,
		pdfPath,
		attachment,
		counts: () => ({ linkCalls, recognizeCalls }),
	};
}

test("registers, pairs, authenticates, and unregisters endpoints", async () => {
	const harness = createHarness();
	const token = "a".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.1.0" });

	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	const configureResponse = await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});
	assert.equal(configureResponse[0], 200);

	const Status = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/status"];
	const statusResponse = await new Status().init({
		headers: { "x-zotero-vault-bridge-token": token },
	});
	assert.equal(statusResponse[0], 200);
	assert.equal(JSON.parse(statusResponse[2]).authenticated, true);

	const rejected = await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": "b".repeat(64) },
		data: { vaultRoot: harness.vaultRoot },
	});
	assert.equal(rejected[0], 403);

	harness.context.VaultBridge.shutdown();
	assert.deepEqual(Object.keys(harness.Zotero.Server.Endpoints), []);
});

test("links and recognizes once, then reuses the existing child attachment", async () => {
	const harness = createHarness();
	const token = "c".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.1.0" });

	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});

	const Import = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/import"];
	const request = {
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.pdfPath },
	};
	const first = await new Import().init(request);
	assert.equal(first[0], 200);
	assert.equal(JSON.parse(first[2]).alreadyImported, false);
	assert.equal(harness.attachment.parentID, 2);
	assert.deepEqual(harness.counts(), { linkCalls: 1, recognizeCalls: 1 });

	const second = await new Import().init(request);
	assert.equal(second[0], 200);
	assert.equal(JSON.parse(second[2]).alreadyImported, true);
	assert.deepEqual(harness.counts(), { linkCalls: 1, recognizeCalls: 1 });
});
