var VaultBridge = new function () {
	const PLUGIN_ID = "zotero-vault-bridge@example.local";
	const PREF_ROOT = "extensions.zotero-vault-bridge.";
	const TOKEN_HEADER = "x-zotero-vault-bridge-token";
	const ENDPOINTS = {
		status: "/zotero-vault-bridge/status",
		configure: "/zotero-vault-bridge/configure",
		import: "/zotero-vault-bridge/import",
		relink: "/zotero-vault-bridge/relink",
		attachmentVerify: "/zotero-vault-bridge/attachments/verify",
		citationSearch: "/zotero-vault-bridge/citations/search",
		citationResolve: "/zotero-vault-bridge/citations/resolve",
		annotations: "/zotero-vault-bridge/annotations",
		itemMetadata: "/zotero-vault-bridge/items/metadata",
	};

	let pluginVersion = "0.0.0";
	let endpointTypes = {};
	let pendingImports = new Map();
	let citationKeyQueue = Promise.resolve();

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
		return requestData?.headers?.[TOKEN_HEADER] || "";
	}

	function requireValidToken(requestData) {
		let stored = getPref("authToken");
		if (!stored) {
			throw new BridgeError(409, "configure_required", "Pair this vault before using the Companion.");
		}
		if (!VaultBridgeCore.constantTimeEqual(stored, presentedToken(requestData))) {
			throw new BridgeError(403, "invalid_token", "The Obsidian vault is not paired with this companion.");
		}
		return stored;
	}

	function canonicalPath(rawPath) {
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

		file.normalize();
		return file.path;
	}

	function canonicalExistingPath(rawPath, expectedKind) {
		let canonical = canonicalPath(rawPath);
		let file = Zotero.File.pathToFile(canonical);
		if (!file.exists()) {
			throw new BridgeError(404, "path_not_found", "The supplied path does not exist.");
		}

		if (expectedKind === "directory" && !file.isDirectory()) {
			throw new BridgeError(400, "vault_root_not_directory", "The configured vault root must be a directory.");
		}
		if (expectedKind === "file" && file.isDirectory()) {
			throw new BridgeError(400, "file_required", "The import path must be a file.");
		}
		return canonical;
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

	async function findAttachmentByKey(rawKey) {
		let attachmentKey = String(rawKey || "").trim().toUpperCase();
		if (!/^[A-Z0-9]{8}$/.test(attachmentKey)) {
			throw new BridgeError(400, "attachment_key_invalid", "A valid Zotero attachment key is required.");
		}
		let itemIDs = await Zotero.DB.columnQueryAsync(
			"SELECT I.itemID FROM items I "
				+ "LEFT JOIN deletedItems DI ON DI.itemID = I.itemID "
				+ "WHERE I.libraryID = ? AND I.key = ? AND DI.itemID IS NULL",
			[Zotero.Libraries.userLibraryID, attachmentKey]
		);
		let attachment = itemIDs.length ? await Zotero.Items.getAsync(itemIDs[0]) : null;
		if (!attachment?.isAttachment?.()
				|| attachment.attachmentLinkMode !== Zotero.Attachments.LINK_MODE_LINKED_FILE) {
			throw new BridgeError(404, "attachment_not_found", "The linked Zotero attachment no longer exists.");
		}
		return attachment;
	}

	function field(item, name) {
		try {
			let val = item.getField(name);
			if (val) return val;
		}
		catch (error) {}
		if (name === "citationKey") {
			try {
				let extra = item.getField("extra") || "";
				let match = /(?:^|\n)citation key\s*:\s*([^\r\n]+)/i.exec(extra);
				if (match) return match[1].trim();
			}
			catch (error) {}
		}
		return "";
	}

	async function citationKeyExists(candidate, itemID) {
		let fieldID = Zotero.ItemFields.getID("citationKey");
		if (!fieldID) {
			let extraFieldID = Zotero.ItemFields.getID("extra");
			if (!extraFieldID) return false;
			let itemIDs = await Zotero.DB.columnQueryAsync(
				"SELECT I.itemID "
					+ "FROM items I "
					+ "JOIN itemData ID ON ID.itemID = I.itemID "
					+ "JOIN itemDataValues IDV ON IDV.valueID = ID.valueID "
					+ "LEFT JOIN deletedItems DI ON DI.itemID = I.itemID "
					+ "WHERE I.libraryID = ? AND ID.fieldID = ? AND LOWER(IDV.value) LIKE ? "
					+ "AND I.itemID != ? AND DI.itemID IS NULL",
				[Zotero.Libraries.userLibraryID, extraFieldID, `%citation key: ${candidate.toLowerCase()}%`, itemID]
			);
			return Boolean(itemIDs?.length);
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

	async function candidateCitationKey(item, metadata, existing) {
		if (existing) {
			if (!VaultBridgeCore.isSafeCitationKey(existing)) {
				throw new BridgeError(422, "citation_key_invalid", "The Zotero item has a citation key that is unsafe for Pandoc and Obsidian.");
			}
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
		return candidate;
	}

	async function ensureCitationKey(item, metadata, existing) {
		if (existing) {
			return candidateCitationKey(item, metadata, existing);
		}
		let operation = citationKeyQueue
			.catch(() => undefined)
			.then(async function () {
				let current = field(item, "citationKey");
				let candidate = await candidateCitationKey(item, metadata, current);
				if (!current) {
					try {
						item.setField("citationKey", candidate);
					}
					catch (e) {
						let extra = field(item, "extra");
						let newExtra = extra ? `${extra}\nCitation Key: ${candidate}` : `Citation Key: ${candidate}`;
						item.setField("extra", newExtra);
					}
					await item.saveTx();
				}
				return candidate;
			});
		citationKeyQueue = operation.then(() => undefined, () => undefined);
		return operation;
	}

	function bibliographicMetadata(item) {
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
		return {
			itemType: json.itemType || item.itemType,
			title,
			creators,
			date,
			year,
			publicationTitle,
			doi: json.DOI || field(item, "DOI"),
			abstractNote: json.abstractNote || field(item, "abstractNote"),
			url: json.url || field(item, "url"),
			citationKey: json.citationKey || field(item, "citationKey"),
		};
	}

	async function itemMetadata(item, attachment, alreadyImported, replacedExisting = false) {
		let metadata = bibliographicMetadata(item);
		metadata.citationKey = await ensureCitationKey(
			item,
			metadata,
			metadata.citationKey,
		);

		return {
			success: true,
			alreadyImported,
			replacedExisting,
			itemKey: item.key,
			attachmentKey: attachment.key,
			metadata,
			selectUri: `zotero://select/library/items/${item.key}`,
		};
	}

	function creatorDisplayName(creator) {
		if (creator?.name) return String(creator.name).trim();
		return [creator?.firstName, creator?.lastName]
			.map(value => String(value || "").trim())
			.filter(Boolean)
			.join(" ");
	}

	function isRegularBibliographicItem(item) {
		if (!item) return false;
		if (typeof item.isRegularItem === "function") return item.isRegularItem();
		return !(item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.());
	}

	function citationSearchItem(item, metadata, citationKey) {
		return {
			itemKey: item.key,
			citationKey,
			title: metadata.title,
			authors: metadata.creators
				.filter(creator => creator.creatorType === "author")
				.map(creatorDisplayName)
				.filter(Boolean),
			year: metadata.year,
			selectUri: `zotero://select/library/items/${item.key}`,
		};
	}

	async function searchCitations(rawQuery, rawLimit) {
		if (rawQuery !== undefined && typeof rawQuery !== "string") {
			throw new BridgeError(400, "citation_query_invalid", "Citation search query must be text.");
		}
		let query = String(rawQuery || "").trim();
		if (query.length > 200) {
			throw new BridgeError(400, "citation_query_too_long", "Citation search query must be at most 200 characters.");
		}
		let limit = Number.isInteger(rawLimit) ? rawLimit : 20;
		limit = Math.max(1, Math.min(50, limit));

		let itemIDs = await Zotero.DB.columnQueryAsync(
			"SELECT I.itemID "
				+ "FROM items I "
				+ "JOIN itemTypes IT ON IT.itemTypeID = I.itemTypeID "
				+ "LEFT JOIN deletedItems DI ON DI.itemID = I.itemID "
				+ "WHERE I.libraryID = ? AND DI.itemID IS NULL "
				+ "AND IT.typeName NOT IN ('attachment', 'note', 'annotation') "
				+ "ORDER BY I.dateModified DESC",
			[Zotero.Libraries.userLibraryID]
		);

		let candidates = [];
		for (let itemID of itemIDs) {
			let item = await Zotero.Items.getAsync(itemID);
			if (!isRegularBibliographicItem(item)) continue;
			let metadata = bibliographicMetadata(item);
			let previewKey = metadata.citationKey
				|| VaultBridgeCore.generateCitationKey(metadata, item.key);
			if (!VaultBridgeCore.isSafeCitationKey(previewKey)) continue;
			let preview = citationSearchItem(item, metadata, previewKey);
			let score = VaultBridgeCore.citationSearchScore(preview, query);
			if (score >= 0) candidates.push({ item, metadata, preview, score });
		}

		candidates.sort((left, right) => right.score - left.score
			|| left.preview.title.localeCompare(right.preview.title)
			|| left.preview.itemKey.localeCompare(right.preview.itemKey));

		let results = [];
		for (let candidate of candidates.slice(0, limit)) {
			try {
				let citationKey = await candidateCitationKey(
					candidate.item,
					candidate.metadata,
					candidate.metadata.citationKey,
				);
				results.push(citationSearchItem(candidate.item, candidate.metadata, citationKey));
			}
			catch (error) {
				log(`Skipped citation candidate ${candidate.item.key}: ${error?.message || error}`);
			}
		}
		return results;
	}

	async function resolveCitation(rawItemKey) {
		let itemKey = String(rawItemKey || "").trim().toUpperCase();
		if (!/^[A-Z0-9]{8}$/.test(itemKey)) {
			throw new BridgeError(400, "item_key_invalid", "A valid Zotero item key is required.");
		}
		let itemIDs = await Zotero.DB.columnQueryAsync(
			"SELECT I.itemID FROM items I "
				+ "LEFT JOIN deletedItems DI ON DI.itemID = I.itemID "
				+ "WHERE I.libraryID = ? AND I.key = ? AND DI.itemID IS NULL",
			[Zotero.Libraries.userLibraryID, itemKey]
		);
		let item = itemIDs.length ? await Zotero.Items.getAsync(itemIDs[0]) : null;
		if (!isRegularBibliographicItem(item)) {
			throw new BridgeError(404, "citation_item_not_found", "The Zotero citation item no longer exists.");
		}
		let metadata = bibliographicMetadata(item);
		let citationKey = await ensureCitationKey(item, metadata, metadata.citationKey);
		return citationSearchItem(item, metadata, citationKey);
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

	function withRecognitionTimeout(operation, rawTimeout) {
		let timeoutMs = VaultBridgeCore.recognitionTimeout(rawTimeout);
		let timeout = Zotero.Promise.delay(timeoutMs).then(() => {
			throw new BridgeError(
					504,
					"recognition_timeout",
					"Zotero recognition is still running. Retry after it finishes; the same linked attachment will be reused.",
				);
		});
		return Promise.race([operation, timeout]);
	}

	async function performImport(filePath, replaceExisting, expectedAttachmentKey) {
		let attachment = await findLinkedAttachment(filePath);
		let alreadyImported = Boolean(attachment);
		if (attachment?.parentID && !replaceExisting) {
			let parent = await Zotero.Items.getAsync(attachment.parentID);
			if (parent) {
				return itemMetadata(parent, attachment, true, false);
			}
		}

		if (attachment?.parentID && replaceExisting) {
			if (expectedAttachmentKey && attachment.key !== expectedAttachmentKey) {
				let completedParent = await Zotero.Items.getAsync(attachment.parentID);
				if (completedParent) {
					return itemMetadata(completedParent, attachment, true, true);
				}
			}
			let oldAttachment = attachment;
			let replacement = await Zotero.Attachments.linkFromFile({ file: filePath });
			let replacementParent = null;
			try {
				replacementParent = await recognizeAttachment(replacement);
				let result = await itemMetadata(replacementParent, replacement, true, true);
				await oldAttachment.eraseTx();
				return result;
			}
			catch (error) {
				try {
					await replacement.eraseTx();
				}
				catch (cleanupError) {
					Zotero.logError(cleanupError);
				}
				if (replacementParent) {
					try {
						await replacementParent.eraseTx();
					}
					catch (cleanupError) {
						Zotero.logError(cleanupError);
					}
				}
				throw error;
			}
		}

		if (!attachment) {
			attachment = await Zotero.Attachments.linkFromFile({ file: filePath });
		}
		let parent = await recognizeAttachment(attachment);
		return itemMetadata(parent, attachment, alreadyImported, false);
	}

	function importFile(rawPath, {
		replaceExisting = false,
		recognitionTimeoutMs,
		expectedAttachmentKey,
	} = {}) {
		let root = configuredRoot();
		let filePath = canonicalExistingPath(rawPath, "file");

		if (!filePath.toLocaleLowerCase("en-US").endsWith(".pdf")) {
			throw new BridgeError(415, "pdf_required", "Only PDF files can be imported.");
		}
		if (!VaultBridgeCore.isPathInsideRoot(filePath, root, Zotero.isWin)) {
			throw new BridgeError(403, "outside_vault", "The PDF path is outside the paired Obsidian vault.");
		}

		let normalizedKey = VaultBridgeCore.normalizePath(filePath, Zotero.isWin);
		let operation = pendingImports.get(normalizedKey);
		if (!operation) {
			operation = performImport(filePath, replaceExisting, expectedAttachmentKey);
			pendingImports.set(normalizedKey, operation);
			operation.then(
				() => {
					if (pendingImports.get(normalizedKey) === operation) pendingImports.delete(normalizedKey);
				},
				() => {
					if (pendingImports.get(normalizedKey) === operation) pendingImports.delete(normalizedKey);
				},
			);
		}
		return withRecognitionTimeout(operation, recognitionTimeoutMs);
	}

	async function relinkFile(rawOldPath, rawNewPath, rawAttachmentKey) {
		let root = configuredRoot();
		let oldPath = canonicalPath(rawOldPath);
		let newPath = canonicalExistingPath(rawNewPath, "file");
		for (let path of [oldPath, newPath]) {
			if (!path.toLocaleLowerCase("en-US").endsWith(".pdf")) {
				throw new BridgeError(415, "pdf_required", "Only PDF linked attachments can be relinked.");
			}
			if (!VaultBridgeCore.isPathInsideRoot(path, root, Zotero.isWin)) {
				throw new BridgeError(403, "outside_vault", "Both PDF paths must remain inside the paired Obsidian vault.");
			}
		}

		let attachment = await findAttachmentByKey(rawAttachmentKey);
		let currentPath = await attachment.getFilePath();
		if (VaultBridgeCore.normalizePath(currentPath, Zotero.isWin)
				!== VaultBridgeCore.normalizePath(oldPath, Zotero.isWin)) {
			throw new BridgeError(409, "stale_attachment_path", "Zotero's linked attachment no longer points to the expected old path.");
		}
		let destination = await findLinkedAttachment(newPath);
		if (destination && destination.id !== attachment.id) {
			throw new BridgeError(409, "destination_already_linked", "Another Zotero attachment already points to the new path.");
		}

		attachment.attachmentPath = newPath;
		if (typeof attachment.saveTx === "function") {
			await attachment.saveTx();
		}
		else {
			await attachment.save();
		}
		let parent = attachment.parentID
			? await Zotero.Items.getAsync(attachment.parentID)
			: null;
		return {
			success: true,
			attachmentKey: attachment.key,
			itemKey: parent?.key || "",
			oldPath,
			newPath,
		};
	}

	async function verifyLinkedAttachment(rawPath, rawAttachmentKey) {
		let root = configuredRoot();
		let expectedPath = canonicalExistingPath(rawPath, "file");
		if (!expectedPath.toLocaleLowerCase("en-US").endsWith(".pdf")) {
			throw new BridgeError(415, "pdf_required", "Only PDF linked attachments can be verified.");
		}
		if (!VaultBridgeCore.isPathInsideRoot(expectedPath, root, Zotero.isWin)) {
			throw new BridgeError(403, "outside_vault", "The PDF path is outside the paired Obsidian vault.");
		}
		let attachment = await findAttachmentByKey(rawAttachmentKey);
		let actualPath = await attachment.getFilePath();
		return {
			success: true,
			matches: VaultBridgeCore.normalizePath(actualPath, Zotero.isWin)
				=== VaultBridgeCore.normalizePath(expectedPath, Zotero.isWin),
			attached: Boolean(attachment.parentID),
		};
	}

	function classifyColor(hex) {
		let clean = String(hex || "").trim().toLowerCase();
		if (clean.startsWith("#ff6") || clean.startsWith("#e0") || clean.startsWith("#d3") || clean.startsWith("#f44")) return "red";
		if (clean.startsWith("#5f") || clean.startsWith("#2e7") || clean.startsWith("#4c") || clean.startsWith("#00a")) return "green";
		if (clean.startsWith("#2e") || clean.startsWith("#197") || clean.startsWith("#219") || clean.startsWith("#007")) return "blue";
		if (clean.startsWith("#a2") || clean.startsWith("#9c2") || clean.startsWith("#673") || clean.startsWith("#7e5") || clean.startsWith("#e56") || clean.startsWith("#ff14")) return "purple";
		if (clean.startsWith("#f19") || clean.startsWith("#ff9") || clean.startsWith("#ffb") || clean.startsWith("#f57")) return "orange";
		if (clean.startsWith("#aaa") || clean.startsWith("#888") || clean.startsWith("#999") || clean.startsWith("#777")) return "gray";
		return "yellow";
	}

	async function getAttachmentAnnotations(rawAttachmentKey, exportImages = false) {
		let attachment = await findAttachmentByKey(rawAttachmentKey);
		let annotations = typeof attachment.getAnnotations === "function"
			? await attachment.getAnnotations()
			: [];

		let results = [];
		for (let anno of annotations) {
			if (!anno) continue;
			let type = anno.annotationType || "highlight";
			let imageBase64;
			if (type === "image" && exportImages) {
				try {
					let imgPath = typeof anno.getImagePath === "function" ? anno.getImagePath() : null;
					if (imgPath && Zotero.File.pathToFile(imgPath).exists()) {
						let bytes = await Zotero.File.getBinaryContentsAsync(imgPath);
						if (typeof Buffer !== "undefined") {
							imageBase64 = Buffer.from(bytes).toString("base64");
						}
						else if (typeof Zotero.Utilities?.base64Encode === "function") {
							imageBase64 = Zotero.Utilities.base64Encode(bytes);
						}
					}
				}
				catch (imgErr) {
					log(`Failed reading image for annotation ${anno.key}: ${imgErr.message}`);
				}
			}

			results.push({
				key: anno.key,
				type,
				text: anno.annotationText || "",
				comment: anno.annotationComment || "",
				color: anno.annotationColor || "#ffd400",
				colorCategory: classifyColor(anno.annotationColor),
				pageLabel: anno.annotationPageLabel || "",
				sortIndex: anno.annotationSortIndex || "",
				tags: Array.isArray(anno.getTags?.()) ? anno.getTags().map(t => t.tag) : [],
				selectUri: `zotero://select/library/items/${anno.key}`,
				openPdfUri: `zotero://open-pdf/library/items/${attachment.key}?page=${encodeURIComponent(anno.annotationPageLabel || "1")}&annotation=${anno.key}`,
				imageBase64,
			});
		}

		results.sort((a, b) => {
			let pageA = parseInt(a.pageLabel || "0", 10) || 0;
			let pageB = parseInt(b.pageLabel || "0", 10) || 0;
			if (pageA !== pageB) return pageA - pageB;
			return String(a.sortIndex || "").localeCompare(String(b.sortIndex || ""));
		});

		let parent = attachment.parentID ? await Zotero.Items.getAsync(attachment.parentID) : null;
		return {
			success: true,
			attachmentKey: attachment.key,
			itemKey: parent?.key || "",
			annotations: results,
		};
	}

	async function getItemAuthoritativeMetadata(rawItemKey, rawAttachmentKey) {
		let item = null;
		let attachment = null;

		if (rawAttachmentKey) {
			try {
				attachment = await findAttachmentByKey(rawAttachmentKey);
				if (attachment.parentID) {
					item = await Zotero.Items.getAsync(attachment.parentID);
				}
			}
			catch (err) {}
		}

		if (!item && rawItemKey) {
			let itemKey = String(rawItemKey || "").trim().toUpperCase();
			if (/^[A-Z0-9]{8}$/.test(itemKey)) {
				let itemIDs = await Zotero.DB.columnQueryAsync(
					"SELECT I.itemID FROM items I "
						+ "LEFT JOIN deletedItems DI ON DI.itemID = I.itemID "
						+ "WHERE I.libraryID = ? AND I.key = ? AND DI.itemID IS NULL",
					[Zotero.Libraries.userLibraryID, itemKey]
				);
				item = itemIDs.length ? await Zotero.Items.getAsync(itemIDs[0]) : null;
			}
		}

		if (!isRegularBibliographicItem(item)) {
			throw new BridgeError(404, "item_not_found", "The Zotero bibliographic item was not found.");
		}

		if (!attachment && typeof item.getAttachments === "function") {
			let attachmentIDs = await item.getAttachments();
			for (let id of attachmentIDs) {
				let att = await Zotero.Items.getAsync(id);
				if (att?.isAttachment?.() && att.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE) {
					attachment = att;
					break;
				}
			}
		}

		let metadata = bibliographicMetadata(item);
		let citationKey = await ensureCitationKey(item, metadata, metadata.citationKey);
		metadata.citationKey = citationKey;

		return {
			success: true,
			itemKey: item.key,
			attachmentKey: attachment?.key || "",
			metadata,
			selectUri: `zotero://select/library/items/${item.key}`,
		};
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

	function makeRelinkEndpoint() {
		return function RelinkEndpoint() {};
	}

	function makeAttachmentVerifyEndpoint() {
		return function AttachmentVerifyEndpoint() {};
	}

	function makeCitationSearchEndpoint() {
		return function CitationSearchEndpoint() {};
	}

	function makeCitationResolveEndpoint() {
		return function CitationResolveEndpoint() {};
	}

	function makeAnnotationsEndpoint() {
		return function AnnotationsEndpoint() {};
	}

	function makeItemMetadataEndpoint() {
		return function ItemMetadataEndpoint() {};
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
					pendingImports: pendingImports.size,
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
					if (requestData.data?.replaceExisting !== undefined
							&& typeof requestData.data.replaceExisting !== "boolean") {
						throw new BridgeError(400, "replace_existing_invalid", "replaceExisting must be a boolean.");
					}
					let expectedAttachmentKey;
					if (requestData.data?.expectedAttachmentKey !== undefined) {
						expectedAttachmentKey = String(requestData.data.expectedAttachmentKey).trim().toUpperCase();
						if (!/^[A-Z0-9]{8}$/.test(expectedAttachmentKey)) {
							throw new BridgeError(400, "expected_attachment_key_invalid", "expectedAttachmentKey must be a valid Zotero attachment key.");
						}
					}
					let result = await importFile(requestData.data?.path, {
						replaceExisting: requestData.data?.replaceExisting === true,
						recognitionTimeoutMs: requestData.data?.recognitionTimeoutMs,
						expectedAttachmentKey,
					});
					return response(200, result);
				}
				catch (error) {
					return errorResponse(error);
				}
			},
		};

		endpointTypes.relink = makeRelinkEndpoint();
		endpointTypes.relink.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					requireValidToken(requestData);
					let result = await relinkFile(
						requestData.data?.oldPath,
						requestData.data?.newPath,
						requestData.data?.attachmentKey,
					);
					return response(200, result);
				}
				catch (error) {
					return errorResponse(error);
				}
			},
		};

		endpointTypes.attachmentVerify = makeAttachmentVerifyEndpoint();
		endpointTypes.attachmentVerify.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					requireValidToken(requestData);
					let result = await verifyLinkedAttachment(
						requestData.data?.path,
						requestData.data?.attachmentKey,
					);
					return response(200, result);
				}
				catch (error) {
					return errorResponse(error);
				}
			},
		};

		endpointTypes.citationSearch = makeCitationSearchEndpoint();
		endpointTypes.citationSearch.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					requireValidToken(requestData);
					let items = await searchCitations(
						requestData.data?.query,
						requestData.data?.limit,
					);
					return response(200, { success: true, items });
				}
				catch (error) {
					return errorResponse(error);
				}
			},
		};

		endpointTypes.citationResolve = makeCitationResolveEndpoint();
		endpointTypes.citationResolve.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					requireValidToken(requestData);
					let item = await resolveCitation(requestData.data?.itemKey);
					return response(200, { success: true, item });
				}
				catch (error) {
					return errorResponse(error);
				}
			},
		};

		endpointTypes.annotations = makeAnnotationsEndpoint();
		endpointTypes.annotations.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					requireValidToken(requestData);
					let result = await getAttachmentAnnotations(
						requestData.data?.attachmentKey,
						requestData.data?.exportImages === true,
					);
					return response(200, result);
				}
				catch (error) {
					return errorResponse(error);
				}
			},
		};

		endpointTypes.itemMetadata = makeItemMetadataEndpoint();
		endpointTypes.itemMetadata.prototype = {
			supportedMethods: ["POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					requireValidToken(requestData);
					let result = await getItemAuthoritativeMetadata(
						requestData.data?.itemKey,
						requestData.data?.attachmentKey,
					);
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
		Zotero.Server.Endpoints[ENDPOINTS.relink] = endpointTypes.relink;
		Zotero.Server.Endpoints[ENDPOINTS.attachmentVerify] = endpointTypes.attachmentVerify;
		Zotero.Server.Endpoints[ENDPOINTS.citationSearch] = endpointTypes.citationSearch;
		Zotero.Server.Endpoints[ENDPOINTS.citationResolve] = endpointTypes.citationResolve;
		Zotero.Server.Endpoints[ENDPOINTS.annotations] = endpointTypes.annotations;
		Zotero.Server.Endpoints[ENDPOINTS.itemMetadata] = endpointTypes.itemMetadata;
		log("Registered localhost endpoints");
	};

	this.shutdown = function () {
		for (let [name, path] of Object.entries(ENDPOINTS)) {
			if (Zotero.Server.Endpoints[path] === endpointTypes[name]) {
				delete Zotero.Server.Endpoints[path];
			}
		}
		pendingImports.clear();
		citationKeyQueue = Promise.resolve();
		endpointTypes = {};
	};
};
