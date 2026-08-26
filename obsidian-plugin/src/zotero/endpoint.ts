const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeLoopbackEndpoint(rawEndpoint: string): string {
	let endpoint: URL;
	try {
		endpoint = new URL(rawEndpoint.trim());
	}
	catch {
		throw new Error("Zotero endpoint must be a valid URL.");
	}

	if (endpoint.protocol !== "http:") {
		throw new Error("Zotero endpoint must use local HTTP.");
	}
	if (!LOOPBACK_HOSTS.has(endpoint.hostname)) {
		throw new Error("Zotero endpoint must use localhost, 127.0.0.1, or [::1].");
	}
	if (endpoint.username || endpoint.password) {
		throw new Error("Zotero endpoint must not contain credentials.");
	}
	if (endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
		throw new Error("Zotero endpoint must contain only the loopback origin and port.");
	}
	return endpoint.origin;
}
