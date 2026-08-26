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

	return {
		normalizePath,
		isPathInsideRoot,
		constantTimeEqual,
		extractYear,
	};
})();

if (typeof module === "object" && module.exports) {
	module.exports = VaultBridgeCore;
}
