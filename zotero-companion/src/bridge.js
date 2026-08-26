var VaultBridge = new function () {
	const PLUGIN_ID = "zotero-vault-bridge@example.local";
	const PREF_ROOT = "extensions.zotero-vault-bridge.";
	const TOKEN_HEADER = "x-zotero-vault-bridge-token";
	const ENDPOINTS = {
		status: "/zotero-vault-bridge/status",
		configure: "/zotero-vault-bridge/configure",
		import: "/zotero-vault-bridge/import",
	};

	let pluginVersion = "0.0.0";
	let endpointTypes = {};
	let pendingImports = new Map();

	class BridgeError extends Error {
		constructor(status, code, message) {
			super(message);
			this.name = "BridgeError";
			this.status = status;
			this.code = code;
		}
	}

	function log(message) {
		Zotero.debug(`Zotero Vault Bridge: ${message}`);
	}

	function getPref(name) {
		return Zotero.Prefs.get(PREF_ROOT + name, true) || "";
	}

	function setPref(name, value) {
		Zotero.Prefs.set(PREF_ROOT + name, value, true);
	}

	function response(status, body) {
		return [status, "application/json", JSON.stringify(body)];
	}

	function errorResponse(error) {
		if (error instanceof BridgeError) {
			return response(error.status, {
				success: false,
				error: error.code,
				message: error.message,
			});
		}
		Zotero.logError(error);
		return response(500, {
			success: false,
			error: "internal_error",
			message: "The Zotero companion encountered an unexpected error.",
		});
	}

	function presentedToken(requestData) {
		return requestData.headers[TOKEN_HEADER] || "";
	}

	function requireValidToken(requestData) {
		let stored = getPref("authToken");
		if (!stored) {
			throw new BridgeError(409, "configure_required", "Pair this vault before importing PDFs.");
		}
		if (!VaultBridgeCore.constantTimeEqual(stored, presentedToken(requestData))) {
			throw new BridgeError(403, "invalid_token", "The Obsidian vault is not paired with this companion.");
		}
		return stored;
	}

	function canonicalExistingPath(rawPath, expectedKind) {
		if (typeof rawPath !== "string" || !rawPath.trim()) {
			throw new BridgeError(400, "path_required", "A non-empty absolute path is required.");
		}

		let file;
		try {
			file = Zotero.File.pathToFile(rawPath.trim());
		}
		catch (error) {
			throw new BridgeError(400, "invalid_path", "The supplied path is invalid.");
		}

		if (!file.exists()) {
			throw new BridgeError(404, "path_not_found", "The supplied path does not exist.");
		}
		file.normalize();

		if (expectedKind === "directory" && !file.isDirectory()) {
			throw new BridgeError(400, "vault_root_not_directory", "The configured vault root must be a directory.");
		}
		if (expectedKind === "file" && file.isDirectory()) {
			throw new BridgeError(400, "file_required", "The import path must be a file.");
		}
		return file.path;
	}

	function configuredRoot() {
		let rawRoot = getPref("allowedVaultRoot");
		if (!rawRoot) {
			throw new BridgeError(409, "configure_required", "No Obsidian vault root is configured.");
		}
		return canonicalExistingPath(rawRoot, "directory");
	}

	async function findLinkedAttachment(filePath) {
		let pathClause = Zotero.isWin ? "LOWER(IA.path) = LOWER(?)" : "IA.path = ?";
		let itemIDs = await Zotero.DB.columnQueryAsync(
			"SELECT IA.itemID "
				+ "FROM itemAttachments IA "
				+ "JOIN items I ON I.itemID = IA.itemID "
				+ "LEFT JOIN deletedItems DI ON DI.itemID = IA.itemID "
				+ "WHERE I.libraryID = ? AND IA.linkMode = ? AND DI.itemID IS NULL AND "
				+ pathClause,
			[
				Zotero.Libraries.userLibraryID,
				Zotero.Attachments.LINK_MODE_LINKED_FILE,
				filePath,
			]
		);

		for (let itemID of itemIDs) {
			let item = await Zotero.Items.getAsync(itemID);
			if (!item || !item.isAttachment()) {
				continue;
			}
			let existingPath = await item.getFilePath();
			if (existingPath
					&& VaultBridgeCore.normalizePath(existingPath, Zotero.isWin)
						=== VaultBridgeCore.normalizePath(filePath, Zotero.isWin)) {
				return item;
			}
		}
		return null;
	}

	function field(item, name) {
		try {
			return item.getField(name) || "";
		}
		catch (error) {
			return "";
		}
	}

	async function citationKeyExists(candidate, itemID) {
		let fieldID = Zotero.ItemFields.getID("citationKey");
		if (!fieldID) {
			throw new BridgeError(500, "citation_key_field_missing", "This Zotero version does not expose the citationKey field.");
		}
		let itemIDs = await Zotero.DB.columnQueryAsync(
			"SELECT I.itemID "
				+ "FROM items I "
				+ "JOIN itemData ID ON ID.itemID = I.itemID "
				+ "JOIN itemDataValues IDV ON IDV.valueID = ID.valueID "
				+ "LEFT JOIN deletedItems DI ON DI.itemID = I.itemID "
				+ "WHERE I.libraryID = ? AND ID.fieldID = ? AND LOWER(IDV.value) = LOWER(?) "
				+ "AND I.itemID != ? AND DI.itemID IS NULL",
			[Zotero.Libraries.userLibraryID, fieldID, candidate, itemID]
		);
		return Boolean(itemIDs?.length);
	}

	async function ensureCitationKey(item, metadata, existing) {
		if (existing) {
			return existing;
		}
		let candidate = VaultBridgeCore.generateCitationKey(metadata, item.key);
		if (await citationKeyExists(candidate, item.id)) {
			let suffix = `-${item.key.toLocaleLowerCase("en-US")}`;
			candidate = candidate.slice(0, 128 - suffix.length) + suffix;
		}
		if (!VaultBridgeCore.isSafeCitationKey(candidate)) {
			throw new BridgeError(500, "citation_key_invalid", "The generated citation key is not safe for an Obsidian filename.");
		}
		if (await citationKeyExists(candidate, item.id)) {
			throw new BridgeError(409, "citation_key_collision", "Zotero already contains the generated citation key.");
		}
		item.setField("citationKey", candidate);
		await item.saveTx();
		return candidate;
	}

	async function itemMetadata(item, attachment, alreadyImported) {
		let json = item.toJSON();
		let date = json.date || field(item, "date");
		let publicationTitle = json.publicationTitle
			|| json.bookTitle
			|| json.proceedingsTitle
			|| field(item, "publicationTitle")
			|| field(item, "bookTitle")
			|| field(item, "proceedingsTitle");
		let creators = Array.isArray(json.creators)
			? json.creators.map(creator => ({
				firstName: creator.firstName || "",
				lastName: creator.lastName || "",
				name: creator.name || "",
				creatorType: creator.creatorType || "author",
			}))
			: [];
		let title = json.title || field(item, "title");
		let year = VaultBridgeCore.extractYear(date);
		let citationKey = await ensureCitationKey(item, {
			title,
			creators,
			date,
			year,
		}, json.citationKey || field(item, "citationKey"));

		return {
			success: true,
			alreadyImported,
			itemKey: item.key,
			attachmentKey: attachment.key,
			metadata: {
				itemType: json.itemType || item.itemType,
				title,
				creators,
				date,
				year,
				publicationTitle,
				doi: json.DOI || field(item, "DOI"),
				abstractNote: json.abstractNote || field(item, "abstractNote"),
				url: json.url || field(item, "url"),
				citationKey,
			},
			selectUri: `zotero://select/library/items/${item.key}`,
		};
	}

	async function recognizeAttachment(attachment) {
		if (attachment.parentID) {
			let parent = await Zotero.Items.getAsync(attachment.parentID);
			if (parent) {
				return parent;
			}
		}
		if (!Zotero.RecognizeDocument.canRecognize(attachment)) {
			throw new BridgeError(415, "not_recognizable", "Zotero cannot recognize this attachment as a top-level PDF.");
		}

		let parent;
		try {
			parent = await Zotero.RecognizeDocument._recognize(attachment);
		}
		catch (error) {
			let message = error?.message || "Zotero could not recognize metadata for this PDF.";
			throw new BridgeError(422, "recognition_failed", message);
		}
		if (!parent) {
			throw new BridgeError(422, "recognition_failed", "Zotero found no metadata match for this PDF.");
		}

		try {
			await Zotero.DB.executeTransaction(async function () {
				attachment.parentID = parent.id;
				await attachment.save();
			});
		}
		catch (error) {
			try {
				await parent.eraseTx();
			}
			catch (cleanupError) {
				Zotero.logError(cleanupError);
			}
			throw error;
		}
		return parent;
	}

	async function importFile(rawPath) {
		let root = configuredRoot();
		let filePath = canonicalExistingPath(rawPath, "file");

		if (!filePath.toLocaleLowerCase("en-US").endsWith(".pdf")) {
			throw new BridgeError(415, "pdf_required", "Only PDF files can be imported.");
		}
		if (!VaultBridgeCore.isPathInsideRoot(filePath, root, Zotero.isWin)) {
			throw new BridgeError(403, "outside_vault", "The PDF path is outside the paired Obsidian vault.");
		}

		let normalizedKey = VaultBridgeCore.normalizePath(filePath, Zotero.isWin);
		if (pendingImports.has(normalizedKey)) {
			return pendingImports.get(normalizedKey);
		}

		let operation = (async function () {
			let attachment = await findLinkedAttachment(filePath);
			let alreadyImported = Boolean(attachment);
			if (attachment?.parentID) {
				let parent = await Zotero.Items.getAsync(attachment.parentID);
				if (parent) {
					return itemMetadata(parent, attachment, true);
				}
			}

			if (!attachment) {
				attachment = await Zotero.Attachments.linkFromFile({ file: filePath });
			}
			let parent = await recognizeAttachment(attachment);
			return itemMetadata(parent, attachment, alreadyImported);
		})();

		pendingImports.set(normalizedKey, operation);
		try {
			return await operation;
		}
		finally {
			pendingImports.delete(normalizedKey);
		}
	}

	function makeStatusEndpoint() {
		return function StatusEndpoint() {};
	}

	function makeConfigureEndpoint() {
		return function ConfigureEndpoint() {};
	}

	function makeImportEndpoint() {
		return function ImportEndpoint() {};
	}

	this.startup = async function ({ version }) {
		pluginVersion = version;

		endpointTypes.status = makeStatusEndpoint();
		endpointTypes.status.prototype = {
			supportedMethods: ["GET"],
			init: async function (requestData) {
				let storedToken = getPref("authToken");
				let configured = Boolean(storedToken && getPref("allowedVaultRoot"));
				return response(200, {
					success: true,
					companionVersion: pluginVersion,
					zoteroVersion: Zotero.version,
					configured,
					authenticated: configured
						&& VaultBridgeCore.constantTimeEqual(storedToken, presentedToken(requestData)),
				});
			},
		};

		endpointTypes.configure = makeConfigureEndpoint();
		endpointTypes.configure.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					let token = presentedToken(requestData);
					if (!/^[a-f0-9]{64}$/i.test(token)) {
						throw new BridgeError(400, "invalid_token_format", "The pairing token must contain 64 hexadecimal characters.");
					}
					let storedToken = getPref("authToken");
					if (storedToken && !VaultBridgeCore.constantTimeEqual(storedToken, token)) {
						throw new BridgeError(403, "invalid_token", "This Zotero companion is already paired with another token.");
					}
					let root = canonicalExistingPath(requestData.data?.vaultRoot, "directory");
					setPref("authToken", token);
					setPref("allowedVaultRoot", root);
					log("Paired an Obsidian vault root");
					return response(200, { success: true, configured: true });
				}
				catch (error) {
					return errorResponse(error);
				}
			},
		};

		endpointTypes.import = makeImportEndpoint();
		endpointTypes.import.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					requireValidToken(requestData);
					let result = await importFile(requestData.data?.path);
					return response(200, result);
				}
				catch (error) {
					return errorResponse(error);
				}
			},
		};

		Zotero.Server.Endpoints[ENDPOINTS.status] = endpointTypes.status;
		Zotero.Server.Endpoints[ENDPOINTS.configure] = endpointTypes.configure;
		Zotero.Server.Endpoints[ENDPOINTS.import] = endpointTypes.import;
		log("Registered localhost endpoints");
	};

	this.shutdown = function () {
		for (let [name, path] of Object.entries(ENDPOINTS)) {
			if (Zotero.Server.Endpoints[path] === endpointTypes[name]) {
				delete Zotero.Server.Endpoints[path];
			}
		}
		pendingImports.clear();
		endpointTypes = {};
	};
};
