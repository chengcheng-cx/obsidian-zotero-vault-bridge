import type { ImportResult, RecognizedMetadata } from "../zotero/ZoteroTypes";

export type PaperStatus = "new" | "processing" | "recognized" | "complete" | "failed";

export interface PaperRecord {
	path: string;
	status: PaperStatus;
	attempts: number;
	updatedAt: string;
	itemKey?: string;
	attachmentKey?: string;
	selectUri?: string;
	metadata?: RecognizedMetadata;
	errorCode?: string;
	errorMessage?: string;
	literatureNote?: string;
}

export type PaperRecords = Record<string, PaperRecord>;

const STATUSES = new Set<PaperStatus>([
	"new",
	"processing",
	"recognized",
	"complete",
	"failed",
]);

function timestamp(): string {
	return new Date().toISOString();
}

export function sanitizePaperRecords(value: unknown): PaperRecords {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	let records: PaperRecords = {};
	for (let [path, rawRecord] of Object.entries(value)) {
		if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
			continue;
		}
		let candidate = rawRecord as Partial<PaperRecord>;
		if (!STATUSES.has(candidate.status as PaperStatus)) {
			continue;
		}
		records[path] = {
			...candidate,
			path,
			status: candidate.status as PaperStatus,
			attempts: Number.isFinite(candidate.attempts) ? Math.max(0, candidate.attempts ?? 0) : 0,
			updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp(),
		};
	}
	return records;
}

export class ImportStateStore {
	private readonly records: PaperRecords;

	constructor(initialRecords: unknown, private readonly persist: () => Promise<void>) {
		this.records = sanitizePaperRecords(initialRecords);
	}

	snapshot(): PaperRecords {
		return structuredClone(this.records);
	}

	get(path: string): PaperRecord | undefined {
		return this.records[path];
	}

	needsImport(path: string, includeFailed: boolean): boolean {
		let record = this.records[path];
		if (!record) {
			return true;
		}
		if (record.status === "complete") {
			return !record.literatureNote;
		}
		if (record.status === "failed") {
			return includeFailed;
		}
		return true;
	}

	async markNew(path: string): Promise<PaperRecord> {
		let existing = this.records[path];
		let record: PaperRecord = {
			path,
			status: "new",
			attempts: existing?.attempts ?? 0,
			updatedAt: timestamp(),
		};
		this.records[path] = record;
		await this.persist();
		return record;
	}

	async markProcessing(path: string): Promise<void> {
		let existing = this.records[path];
		this.records[path] = {
			...existing,
			path,
			status: "processing",
			attempts: (existing?.attempts ?? 0) + 1,
			updatedAt: timestamp(),
			errorCode: undefined,
			errorMessage: undefined,
		};
		await this.persist();
	}

	async markRecognized(path: string, result: ImportResult): Promise<void> {
		let existing = this.records[path];
		this.records[path] = {
			...existing,
			path,
			status: "recognized",
			attempts: existing?.attempts ?? 1,
			updatedAt: timestamp(),
			itemKey: result.itemKey,
			attachmentKey: result.attachmentKey,
			selectUri: result.selectUri,
			metadata: result.metadata,
			errorCode: undefined,
			errorMessage: undefined,
		};
		await this.persist();
	}

	async markComplete(path: string): Promise<void> {
		let existing = this.records[path];
		if (!existing) {
			throw new Error(`Cannot complete unknown paper: ${path}`);
		}
		this.records[path] = {
			...existing,
			status: "complete",
			updatedAt: timestamp(),
		};
		await this.persist();
	}

	async markLiteratureNote(path: string, literatureNote: string): Promise<void> {
		let existing = this.records[path];
		if (!existing) {
			throw new Error(`Cannot attach a Literature Note to an unknown paper: ${path}`);
		}
		this.records[path] = {
			...existing,
			literatureNote,
			updatedAt: timestamp(),
		};
		await this.persist();
	}

	async markFailed(path: string, code: string, message: string): Promise<void> {
		let existing = this.records[path];
		this.records[path] = {
			...existing,
			path,
			status: "failed",
			attempts: existing?.attempts ?? 1,
			updatedAt: timestamp(),
			errorCode: code,
			errorMessage: message,
		};
		await this.persist();
	}
}
