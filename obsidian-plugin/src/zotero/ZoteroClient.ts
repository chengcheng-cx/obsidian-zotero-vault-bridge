import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import { normalizeLoopbackEndpoint } from "./endpoint";
import type {
	BridgeErrorPayload,
	BridgeStatus,
	CitationResolveResult,
	CitationSearchItem,
	CitationSearchResult,
	ImportResult,
	RelinkResult,
} from "./ZoteroTypes";

const TOKEN_HEADER = "X-Zotero-Vault-Bridge-Token";

export class ZoteroBridgeClientError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "ZoteroBridgeClientError";
	}
}

export class ZoteroBridgeClient {
	constructor(
		private readonly getEndpoint: () => string,
		private readonly getToken: () => string,
	) {}

	async status(): Promise<BridgeStatus> {
		return this.request<BridgeStatus>("/zotero-vault-bridge/status", "GET");
	}

	async configure(vaultRoot: string): Promise<void> {
		await this.request<{ success: true; configured: true }>(
			"/zotero-vault-bridge/configure",
			"POST",
			{ vaultRoot },
		);
	}

	async ensureConfigured(vaultRoot: string): Promise<BridgeStatus> {
		let before = await this.status();
		if (before.configured && !before.authenticated) {
			throw new ZoteroBridgeClientError(
				"The Zotero companion is paired with a different token. Reset its bridge preferences or restore this plugin's data.json.",
				"pairing_mismatch",
				403,
			);
		}
		await this.configure(vaultRoot);
		let after = await this.status();
		if (!after.authenticated) {
			throw new ZoteroBridgeClientError(
				"Zotero accepted the vault configuration but did not authenticate the pairing.",
				"pairing_failed",
			);
		}
		return after;
	}

	async importPdf(
		absolutePath: string,
		options: {
			replaceExisting: boolean;
			recognitionTimeoutMs: number;
			expectedAttachmentKey?: string;
		},
	): Promise<ImportResult> {
		return this.request<ImportResult>(
			"/zotero-vault-bridge/import",
			"POST",
			{ path: absolutePath, ...options },
		);
	}

	async relinkPdf(
		oldAbsolutePath: string,
		newAbsolutePath: string,
		attachmentKey: string,
	): Promise<RelinkResult> {
		return this.request<RelinkResult>(
			"/zotero-vault-bridge/relink",
			"POST",
			{
				oldPath: oldAbsolutePath,
				newPath: newAbsolutePath,
				attachmentKey,
			},
		);
	}

	async searchCitations(query: string, limit = 20): Promise<CitationSearchItem[]> {
		let result = await this.request<CitationSearchResult>(
			"/zotero-vault-bridge/citations/search",
			"POST",
			{ query, limit },
		);
		return result.items;
	}

	async resolveCitation(itemKey: string): Promise<CitationSearchItem> {
		let result = await this.request<CitationResolveResult>(
			"/zotero-vault-bridge/citations/resolve",
			"POST",
			{ itemKey },
		);
		return result.item;
	}

	private async request<T>(route: string, method: "GET" | "POST", body?: object): Promise<T> {
		let endpoint: string;
		try {
			endpoint = normalizeLoopbackEndpoint(this.getEndpoint());
		}
		catch (error) {
			throw new ZoteroBridgeClientError(
				error instanceof Error ? error.message : "Invalid Zotero endpoint.",
				"invalid_endpoint",
			);
		}

		let parameters: RequestUrlParam = {
			url: endpoint + route,
			method,
			headers: {
				"Zotero-Allowed-Request": "1",
				[TOKEN_HEADER]: this.getToken(),
			},
			throw: false,
		};
		if (body) {
			parameters.contentType = "application/json";
			parameters.body = JSON.stringify(body);
		}

		let response: RequestUrlResponse;
		try {
			response = await requestUrl(parameters);
		}
		catch (error) {
			throw new ZoteroBridgeClientError(
				"Zotero is unavailable. Start Zotero and confirm that the Companion is installed.",
				"zotero_unavailable",
			);
		}

		let payload = this.readJson(response);
		if (response.status < 200 || response.status >= 300) {
			let bridgeError = this.isBridgeError(payload) ? payload : undefined;
			let code = bridgeError?.error
				?? (response.status === 404 ? "companion_missing" : "http_error");
			let message = bridgeError?.message
				?? (response.status === 404
					? "Zotero is running, but the Vault Bridge Companion endpoint is missing."
					: `Zotero returned HTTP ${response.status}.`);
			throw new ZoteroBridgeClientError(message, code, response.status);
		}
		if (!payload || typeof payload !== "object") {
			throw new ZoteroBridgeClientError(
				"Zotero returned an invalid JSON response.",
				"invalid_response",
				response.status,
			);
		}
		return payload as T;
	}

	private readJson(response: RequestUrlResponse): unknown {
		try {
			return response.json;
		}
		catch {
			try {
				return JSON.parse(response.text) as unknown;
			}
			catch {
				return undefined;
			}
		}
	}

	private isBridgeError(value: unknown): value is BridgeErrorPayload {
		if (!value || typeof value !== "object") {
			return false;
		}
		let candidate = value as Partial<BridgeErrorPayload>;
		return candidate.success === false
			&& typeof candidate.error === "string"
			&& typeof candidate.message === "string";
	}
}
