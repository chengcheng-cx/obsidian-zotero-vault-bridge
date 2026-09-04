const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceDirectory = path.resolve(__dirname, "../src");
const coreSource = fs.readFileSync(path.join(sourceDirectory, "core.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(sourceDirectory, "bridge.js"), "utf8");

function createHarness({
	citationCollision = false,
	initialCitationKey = "",
	recognitionDeferred = false,
	recognitionFailsOnCall = 0,
	timeoutImmediately = false,
} = {}) {
	const vaultRoot = "C:\\Research\\Vault";
	const pdfPath = `${vaultRoot}\\01_Papers\\paper.pdf`;
	const renamedPdfPath = `${vaultRoot}\\01_Papers\\paper-renamed.pdf`;
	const preferences = new Map();
	const endpoints = {};
	let linkCalls = 0;
	let recognizeCalls = 0;
	let citationSaveCalls = 0;
	let citationKey = initialCitationKey;
	let nextAttachmentID = 100;
	const attachments = [];

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
				citationKey,
			};
		},
		getField(name) { return name === "citationKey" ? citationKey : ""; },
		setField(name, value) {
			if (name === "citationKey") citationKey = value;
		},
		async saveTx() { citationSaveCalls += 1; },
		async eraseTx() {},
		isRegularItem() { return true; },
	};
	function makeAttachment(filePath) {
		let id = nextAttachmentID++;
		let storedPath = filePath;
		return {
			id,
			key: `ATTA${String(id).padStart(4, "0")}`,
			libraryID: 1,
			parentID: null,
			attachmentLinkMode: 2,
			get attachmentPath() { return storedPath; },
			set attachmentPath(value) { storedPath = value; },
			isAttachment() { return true; },
			async getFilePath() { return storedPath; },
			async save() {},
			async saveTx() {},
			async eraseTx() {
				let index = attachments.indexOf(this);
				if (index >= 0) attachments.splice(index, 1);
			},
			async getAnnotations() {
				return [
					{
						key: "ANNO0002",
						annotationType: "highlight",
						annotationText: "Second page insight",
						annotationComment: "Comment on page 2",
						annotationColor: "#ff6666",
						annotationPageLabel: "2",
						annotationSortIndex: "00002|000010",
						getTags() { return [{ tag: "critical" }]; },
					},
					{
						key: "ANNO0001",
						annotationType: "highlight",
						annotationText: "First page insight",
						annotationComment: "",
						annotationColor: "#ffd400",
						annotationPageLabel: "1",
						annotationSortIndex: "00001|000005",
						getTags() { return []; },
					},
					{
						key: "ANNO0003",
						annotationType: "highlight",
						annotationText: "Magenta insight",
						annotationComment: "",
						annotationColor: "#e56eee",
						annotationPageLabel: "3",
						annotationSortIndex: "00003|000001",
						getTags() { return []; },
					},
					{
						key: "ANNO0004",
						annotationType: "highlight",
						annotationText: "Gray insight",
						annotationComment: "",
						annotationColor: "#aaaaaa",
						annotationPageLabel: "4",
						annotationSortIndex: "00004|000001",
						getTags() { return []; },
					},
				];
			},
		};
	}
	const attachment = makeAttachment(pdfPath);

	function fileFor(rawPath) {
		if (rawPath !== vaultRoot && rawPath !== pdfPath && rawPath !== renamedPdfPath) {
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
		Promise: {
			delay(milliseconds) {
				return new Promise(resolve => {
					if (timeoutImmediately) queueMicrotask(resolve);
					else setTimeout(resolve, milliseconds).unref();
				});
			},
		},
		Prefs: {
			get(key) { return preferences.get(key); },
			set(key, value) { preferences.set(key, value); },
		},
		File: { pathToFile: fileFor },
		Server: { Endpoints: endpoints },
		Libraries: { userLibraryID: 1 },
		ItemFields: {
			getID(name) { return name === "citationKey" ? 999 : false; },
		},
		Attachments: {
			LINK_MODE_LINKED_FILE: 2,
			async linkFromFile({ file }) {
				linkCalls += 1;
				let created = linkCalls === 1 ? attachment : makeAttachment(file);
				attachments.push(created);
				return created;
			},
		},
		DB: {
			async columnQueryAsync(query, parameters) {
				if (query.includes("itemDataValues")) {
					return citationCollision && parameters[2] === "lovelace2026recognized" ? [999] : [];
				}
				if (query.includes("JOIN itemTypes")) {
					return [parent.id];
				}
				if (query.includes("I.key = ?")) {
					if (parameters[1] === parent.key) return [parent.id];
					let matched = attachments.find(item => item.key === parameters[1]);
					return matched ? [matched.id] : [];
				}
				let requestedPath = parameters[parameters.length - 1];
				return attachments
					.filter(item => item.attachmentPath.toLowerCase() === String(requestedPath).toLowerCase())
					.map(item => item.id);
			},
			async executeTransaction(callback) { return callback(); },
		},
		Items: {
			async getAsync(id) {
				let matched = attachments.find(item => item.id === id);
				if (matched) return matched;
				if (id === parent.id) return parent;
				return null;
			},
		},
		RecognizeDocument: {
			canRecognize() { return true; },
			async _recognize() {
				recognizeCalls += 1;
				if (recognitionFailsOnCall === recognizeCalls) {
					throw new Error("Deliberate recognition failure");
				}
				if (recognitionDeferred) return new Promise(() => undefined);
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
		renamedPdfPath,
		parent,
		attachment,
		attachmentCount: () => attachments.length,
		counts: () => ({ linkCalls, recognizeCalls, citationSaveCalls }),
		citationKey: () => citationKey,
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
	assert.deepEqual(harness.counts(), { linkCalls: 1, recognizeCalls: 1, citationSaveCalls: 1 });
	assert.equal(JSON.parse(first[2]).metadata.citationKey, "lovelace2026recognized");

	const second = await new Import().init(request);
	assert.equal(second[0], 200);
	assert.equal(JSON.parse(second[2]).alreadyImported, true);
	assert.deepEqual(harness.counts(), { linkCalls: 1, recognizeCalls: 1, citationSaveCalls: 1 });
});

test("recognizes replacement content with a new attachment and removes the stale attachment", async () => {
	const harness = createHarness();
	const token = "1".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.5.0" });
	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});
	const Import = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/import"];
	const request = {
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.pdfPath, recognitionTimeoutMs: 120_000 },
	};
	const initial = JSON.parse((await new Import().init(request))[2]);
	const replaced = await new Import().init({
		...request,
		data: {
			...request.data,
			replaceExisting: true,
			expectedAttachmentKey: initial.attachmentKey,
		},
	});

	assert.equal(replaced[0], 200);
	const replacement = JSON.parse(replaced[2]);
	assert.equal(replacement.replacedExisting, true);
	assert.notEqual(replacement.attachmentKey, initial.attachmentKey);
	assert.deepEqual(harness.counts(), { linkCalls: 2, recognizeCalls: 2, citationSaveCalls: 1 });
	assert.equal(harness.attachmentCount(), 1);

	const retried = await new Import().init({
		...request,
		data: {
			...request.data,
			replaceExisting: true,
			expectedAttachmentKey: initial.attachmentKey,
		},
	});
	assert.equal(retried[0], 200);
	assert.equal(JSON.parse(retried[2]).attachmentKey, replacement.attachmentKey);
	assert.deepEqual(harness.counts(), { linkCalls: 2, recognizeCalls: 2, citationSaveCalls: 1 });
	assert.equal(harness.attachmentCount(), 1);
});

test("preserves the original child attachment when replacement recognition fails", async () => {
	const harness = createHarness({ recognitionFailsOnCall: 2 });
	const token = "4".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.5.0" });
	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});
	const Import = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/import"];
	const initial = JSON.parse((await new Import().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.pdfPath },
	}))[2]);

	const failed = await new Import().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: {
			path: harness.pdfPath,
			replaceExisting: true,
			expectedAttachmentKey: initial.attachmentKey,
		},
	});
	assert.equal(failed[0], 422);
	assert.equal(JSON.parse(failed[2]).error, "recognition_failed");
	assert.equal(harness.attachmentCount(), 1);
	assert.equal(harness.attachment.key, initial.attachmentKey);
	assert.equal(harness.attachment.parentID, 2);
	assert.deepEqual(harness.counts(), { linkCalls: 2, recognizeCalls: 2, citationSaveCalls: 1 });
});

test("relinks a tracked attachment after an Obsidian rename", async () => {
	const harness = createHarness();
	const token = "2".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.5.0" });
	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});
	const Import = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/import"];
	const imported = JSON.parse((await new Import().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.pdfPath },
	}))[2]);

	const Relink = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/relink"];
	const relinked = await new Relink().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: {
			oldPath: harness.pdfPath,
			newPath: harness.renamedPdfPath,
			attachmentKey: imported.attachmentKey,
		},
	});
	assert.equal(relinked[0], 200);
	assert.equal(JSON.parse(relinked[2]).newPath, harness.renamedPdfPath);
	assert.equal(await harness.attachment.getFilePath(), harness.renamedPdfPath);
	const Verify = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/attachments/verify"];
	const verified = await new Verify().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.renamedPdfPath, attachmentKey: imported.attachmentKey },
	});
	assert.equal(verified[0], 200);
	assert.deepEqual(JSON.parse(verified[2]), { success: true, matches: true, attached: true });

	const reused = await new Import().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.renamedPdfPath },
	});
	assert.equal(reused[0], 200);
	assert.equal(JSON.parse(reused[2]).alreadyImported, true);
	assert.deepEqual(harness.counts(), { linkCalls: 1, recognizeCalls: 1, citationSaveCalls: 1 });
});

test("bounds recognition time while keeping one pending operation for retry", async () => {
	const harness = createHarness({ recognitionDeferred: true, timeoutImmediately: true });
	const token = "3".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.5.0" });
	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});
	const Import = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/import"];
	const request = {
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.pdfPath, recognitionTimeoutMs: 10_000 },
	};
	const first = await new Import().init(request);
	const second = await new Import().init(request);
	assert.equal(first[0], 504);
	assert.equal(JSON.parse(first[2]).error, "recognition_timeout");
	assert.equal(second[0], 504);
	assert.deepEqual(harness.counts(), { linkCalls: 1, recognizeCalls: 1, citationSaveCalls: 0 });

	const Status = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/status"];
	const status = JSON.parse((await new Status().init({
		headers: { "x-zotero-vault-bridge-token": token },
	}))[2]);
	assert.equal(status.pendingImports, 1);
	harness.context.VaultBridge.shutdown();
});

test("adds the Zotero item key when a generated citation key collides", async () => {
	const harness = createHarness({ citationCollision: true });
	const token = "d".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.2.0" });

	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});
	const Import = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/import"];
	const imported = await new Import().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.pdfPath },
	});

	assert.equal(imported[0], 200);
	assert.equal(JSON.parse(imported[2]).metadata.citationKey, "lovelace2026recognized-item0001");
	assert.equal(harness.citationKey(), "lovelace2026recognized-item0001");
});

test("preserves an existing Zotero citation key", async () => {
	const harness = createHarness({ initialCitationKey: "customCitationKey" });
	const token = "e".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.2.0" });

	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});
	const Import = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/import"];
	const imported = await new Import().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { path: harness.pdfPath },
	});

	assert.equal(imported[0], 200);
	assert.equal(JSON.parse(imported[2]).metadata.citationKey, "customCitationKey");
	assert.equal(harness.counts().citationSaveCalls, 0);
});

test("searches citations without writing and persists only the selected item", async () => {
	const harness = createHarness();
	const token = "f".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.3.0" });

	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});

	const Search = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/citations/search"];
	const unauthorized = await new Search().init({
		headers: { "x-zotero-vault-bridge-token": "0".repeat(64) },
		data: { query: "Ada", limit: 20 },
	});
	assert.equal(unauthorized[0], 403);

	const searched = await new Search().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { query: "Ada 2026", limit: 20 },
	});
	assert.equal(searched[0], 200);
	const items = JSON.parse(searched[2]).items;
	assert.equal(items.length, 1);
	assert.equal(items[0].citationKey, "lovelace2026recognized");
	assert.equal(harness.counts().citationSaveCalls, 0);

	const Resolve = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/citations/resolve"];
	const resolved = await new Resolve().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { itemKey: items[0].itemKey },
	});
	assert.equal(resolved[0], 200);
	assert.equal(JSON.parse(resolved[2]).item.citationKey, "lovelace2026recognized");
	assert.equal(harness.counts().citationSaveCalls, 1);
});

test("fetches and sorts annotations with semantic colors and deep links", async () => {
	const harness = createHarness();
	const token = "b".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.5.0" });

	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});

	await harness.Zotero.Attachments.linkFromFile({ file: harness.pdfPath });

	const Annotations = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/annotations"];
	const unauthorized = await new Annotations().init({
		headers: { "x-zotero-vault-bridge-token": "c".repeat(64) },
		data: { attachmentKey: harness.attachment.key },
	});
	assert.equal(unauthorized[0], 403);

	const res = await new Annotations().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { attachmentKey: harness.attachment.key },
	});
	assert.equal(res[0], 200);
	const data = JSON.parse(res[2]);
	assert.equal(data.success, true);
	assert.equal(data.annotations.length, 4);
	assert.equal(data.annotations[0].key, "ANNO0001");
	assert.equal(data.annotations[0].pageLabel, "1");
	assert.equal(data.annotations[0].colorCategory, "yellow");
	assert.equal(data.annotations[0].openPdfUri, `zotero://open-pdf/library/items/${harness.attachment.key}?page=1&annotation=ANNO0001`);
	assert.equal(data.annotations[1].key, "ANNO0002");
	assert.equal(data.annotations[1].pageLabel, "2");
	assert.equal(data.annotations[1].colorCategory, "red");
	assert.deepEqual(data.annotations[1].tags, ["critical"]);
	assert.equal(data.annotations[2].key, "ANNO0003");
	assert.equal(data.annotations[2].colorCategory, "purple");
	assert.equal(data.annotations[3].key, "ANNO0004");
	assert.equal(data.annotations[3].colorCategory, "gray");
});

test("fetches authoritative item metadata for state recovery", async () => {
	const harness = createHarness();
	const token = "d".repeat(64);
	await harness.context.VaultBridge.startup({ version: "0.5.0" });

	const Configure = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/configure"];
	await new Configure().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { vaultRoot: harness.vaultRoot },
	});

	await harness.Zotero.Attachments.linkFromFile({ file: harness.pdfPath });
	harness.attachment.parentID = harness.parent.id;

	const ItemMetadata = harness.Zotero.Server.Endpoints["/zotero-vault-bridge/items/metadata"];
	const resByItem = await new ItemMetadata().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { itemKey: harness.parent.key },
	});
	assert.equal(resByItem[0], 200);
	const data = JSON.parse(resByItem[2]);
	assert.equal(data.success, true);
	assert.equal(data.itemKey, "ITEM0001");
	assert.equal(data.metadata.title, "Recognized Paper");
	assert.equal(data.metadata.citationKey, "lovelace2026recognized");
	assert.equal(data.metadata.creators[0].lastName, "Lovelace");

	const resByAtt = await new ItemMetadata().init({
		headers: { "x-zotero-vault-bridge-token": token },
		data: { attachmentKey: harness.attachment.key },
	});
	assert.equal(resByAtt[0], 200);
	const attData = JSON.parse(resByAtt[2]);
	assert.equal(attData.itemKey, "ITEM0001");
	assert.equal(attData.attachmentKey, harness.attachment.key);
});
