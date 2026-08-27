import type { ImportResult, RecognizedMetadata } from "../zotero/ZoteroTypes";
import {
	isValidFingerprint,
	sameFileStat,
	type FileFingerprint,
} from "./fingerprint";

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
	fingerprint?: FileFingerprint;
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
			fingerprint: isValidFingerprint(candidate.fingerprint)
				? { ...candidate.fingerprint, sha256: candidate.fingerprint.sha256.toLowerCase() }
				: undefined,
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

	needsImport(
		path: string,
		includeFailed: boolean,
		currentStat?: Pick<FileFingerprint, "size" | "mtime">,
	): boolean {
		let record = this.records[path];
		if (!record) {
			return true;
		}
		if (record.status === "complete") {
			return !record.literatureNote
				|| !record.fingerprint
				|| !sameFileStat(record.fingerprint, currentStat);
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

	async markRecognized(
		path: string,
		result: ImportResult,
		fingerprint: FileFingerprint,
	): Promise<void> {
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
			fingerprint,
			errorCode: undefined,
			errorMessage: undefined,
		};
		await this.persist();
	}

	async updateFingerprint(path: string, fingerprint: FileFingerprint): Promise<void> {
		let existing = this.records[path];
		if (!existing) {
			throw new Error(`Cannot fingerprint unknown paper: ${path}`);
		}
		this.records[path] = {
			...existing,
			fingerprint,
			updatedAt: timestamp(),
		};
		await this.persist();
	}

	async move(
		oldPath: string,
		newPath: string,
		fingerprint?: FileFingerprint,
		status?: PaperStatus,
	): Promise<PaperRecord> {
		let existing = this.records[oldPath];
		if (!existing) {
			throw new Error(`Cannot move unknown paper: ${oldPath}`);
		}
		if (oldPath !== newPath && this.records[newPath]) {
			throw new Error(`Cannot move paper state onto an existing record: ${newPath}`);
		}
		let moved: PaperRecord = {
			...existing,
			path: newPath,
			status: status ?? existing.status,
			fingerprint: fingerprint ?? existing.fingerprint,
			updatedAt: timestamp(),
		};
		delete this.records[oldPath];
		this.records[newPath] = moved;
		await this.persist();
		return moved;
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
