var VaultBridgeCore = (function () {
	function normalizePath(input, windows) {
		if (typeof input !== "string" || !input.trim()) {
			return "";
		}

		let value = input.trim().replace(/\\/g, "/");
		let prefix = "";
		let remainder = value;

		if (value.startsWith("//")) {
			prefix = "//";
			remainder = value.slice(2);
		}
		else if (/^[A-Za-z]:\//.test(value)) {
			prefix = value.slice(0, 2) + "/";
			remainder = value.slice(3);
		}
		else if (value.startsWith("/")) {
			prefix = "/";
			remainder = value.slice(1);
		}

		let parts = [];
		for (let part of remainder.split(/\/+/)) {
			if (!part || part === ".") {
				continue;
			}
			if (part === "..") {
				if (parts.length && parts[parts.length - 1] !== "..") {
					parts.pop();
				}
				else if (!prefix) {
					parts.push(part);
				}
				continue;
			}
			parts.push(part);
		}

		let normalized = prefix + parts.join("/");
		if (normalized.length > prefix.length) {
			normalized = normalized.replace(/\/+$/, "");
		}
		return windows ? normalized.toLocaleLowerCase("en-US") : normalized;
	}

	function isPathInsideRoot(candidate, root, windows) {
		let normalizedCandidate = normalizePath(candidate, windows);
		let normalizedRoot = normalizePath(root, windows);
		if (!normalizedCandidate || !normalizedRoot || normalizedCandidate === normalizedRoot) {
			return false;
		}
		return normalizedCandidate.startsWith(normalizedRoot + "/");
	}

	function constantTimeEqual(left, right) {
		if (typeof left !== "string" || typeof right !== "string") {
			return false;
		}
		let difference = left.length ^ right.length;
		let length = Math.max(left.length, right.length);
		for (let index = 0; index < length; index++) {
			difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
		}
		return difference === 0;
	}

	function extractYear(value) {
		let match = String(value || "").match(/(?:^|\D)(\d{4})(?:\D|$)/);
		return match ? match[1] : "";
	}

	function citationPart(value) {
		return String(value || "")
			.normalize("NFKD")
			.replace(/\p{M}/gu, "")
			.toLocaleLowerCase("en-US")
			.match(/[\p{L}\p{N}]+/gu)
			?.join("") || "";
	}

	function generateCitationKey(metadata, itemKey) {
		let creators = Array.isArray(metadata?.creators) ? metadata.creators : [];
		let firstAuthor = creators.find(creator => creator?.creatorType === "author") || creators[0] || {};
		let author = citationPart(firstAuthor.lastName || firstAuthor.name || firstAuthor.firstName) || "anon";
		let year = extractYear(metadata?.year || metadata?.date) || "nd";
		let stopwords = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "using", "with"]);
		let titleWords = String(metadata?.title || "").match(/[\p{L}\p{N}]+/gu) || [];
		let title = titleWords
			.map(citationPart)
			.find(word => word && !stopwords.has(word))
			|| "untitled";
		let generated = Array.from(`${author}${year}${title}`).slice(0, 96).join("");
		return generated || `item${citationPart(itemKey) || "unknown"}`;
	}

	function isSafeCitationKey(value) {
		let candidate = String(value || "");
		return /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u.test(candidate)
			&& !/[. ]$/.test(candidate)
			&& !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(candidate);
	}

	return {
		normalizePath,
		isPathInsideRoot,
		constantTimeEqual,
		extractYear,
		generateCitationKey,
		isSafeCitationKey,
	};
})();

if (typeof module === "object" && module.exports) {
	module.exports = VaultBridgeCore;
}
