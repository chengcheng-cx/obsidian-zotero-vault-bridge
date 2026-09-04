import {
	FileSystemAdapter,
	TFile,
	type App,
} from "obsidian";
import type { LiteratureNoteWriter } from "../literature/LiteratureNoteService";
import { readFrontmatterScalar } from "../literature/NoteContent";
import type { BridgeSettings } from "../settings";
import {
	ZoteroBridgeClient,
	ZoteroBridgeClientError,
} from "../zotero/ZoteroClient";
import type { PaperRecord } from "./ImportState";
import { ImportStateStore } from "./ImportState";
import { waitForStableFile } from "./fileStability";
import {
	sameFileContent,
	sameFileStat,
	sha256Hex,
	type FileFingerprint,
} from "./fingerprint";

export interface ImportOptions {
	force?: boolean;
}

interface InFlightImport {
	controller: AbortController;
	promise: Promise<PaperRecord>;
}

export class ImportCancelledError extends Error {
	constructor() {
		super("The PDF import was cancelled. Retry it when you are ready.");
		this.name = "ImportCancelledError";
	}
}

export class ImportService {
	private readonly inFlight = new Map<string, InFlightImport>();

	constructor(
		private readonly app: App,
		private readonly state: ImportStateStore,
		private readonly client: ZoteroBridgeClient,
		private readonly literatureNotes: LiteratureNoteWriter,
		private readonly getSettings: () => BridgeSettings,
		private readonly getVaultRoot: () => string,
	) {}

	async importFile(file: TFile, options: ImportOptions = {}): Promise<PaperRecord> {
		return this.importPath(file.path, options);
	}

	private async importPath(path: string, options: ImportOptions = {}): Promise<PaperRecord> {
		let current = this.state.get(path);
		if (current?.status === "complete" && current.literatureNote && current.fingerprint && !options.force) {
			let stat = await this.requireFileSystemAdapter().stat(path);
			if (stat && sameFileStat(current.fingerprint, stat)) {
				return current;
			}
		}
		let existing = this.inFlight.get(path);
		if (existing) {
			return existing.promise;
		}

		let controller = new AbortController();
		let operation = this.runImport(path, options, controller.signal);
		this.inFlight.set(path, { controller, promise: operation });
		try {
			return await operation;
		}
		finally {
			this.inFlight.delete(path);
		}
	}

	cancelAll(): number {
		let cancelled = 0;
		for (let operation of this.inFlight.values()) {
			if (!operation.controller.signal.aborted) {
				operation.controller.abort();
				cancelled += 1;
			}
		}
		return cancelled;
	}

	async relinkFile(file: TFile, oldPath: string): Promise<PaperRecord> {
		let newPath = file.path;
		let active = this.inFlight.get(oldPath);
		if (active) {
			await active.promise.catch(() => undefined);
		}

		let existing = this.state.get(oldPath);
		if (!existing) {
			return this.importPath(newPath);
		}
		if (oldPath !== newPath && this.state.get(newPath)) {
			throw new Error(`Cannot relink paper state onto an existing record: ${newPath}`);
		}

		let adapter = this.requireFileSystemAdapter();
		let settings = this.getSettings();
		let fingerprint = await this.fingerprintFile(adapter, newPath, settings, new AbortController().signal);
		let contentChanged = Boolean(existing.fingerprint
			&& !sameFileContent(existing.fingerprint, fingerprint));
		let canRelinkWithoutImport = Boolean(
			!contentChanged
			&& existing.attachmentKey
			&& existing.status === "complete"
			&& existing.metadata,
		);

		if (existing.attachmentKey) {
			await this.client.ensureConfigured(this.getVaultRoot());
			await this.client.relinkPdf(
				adapter.getFullPath(oldPath),
				adapter.getFullPath(newPath),
				existing.attachmentKey,
			);
		}

		let moved = await this.state.move(
			oldPath,
			newPath,
			contentChanged ? undefined : fingerprint,
			canRelinkWithoutImport ? "recognized" : undefined,
		);
		if (!canRelinkWithoutImport) {
			return this.importPath(newPath, { force: true });
		}

		let annotations = (settings.syncAnnotationsOnImport && moved.attachmentKey)
			? await this.client.getAnnotations(moved.attachmentKey, { exportImages: settings.exportAnnotationImages })
				.then(res => res.annotations)
				.catch(() => [])
			: [];
		let note = await this.literatureNotes.createOrUpdate(newPath, moved, annotations);
		await this.state.markLiteratureNote(newPath, note.path);
		await this.state.markComplete(newPath);
		let completed = this.state.get(newPath);
		if (!completed) {
			throw new Error("Relink completed without a persisted paper record.");
		}
		return completed;
	}

	async handleFileMissing(path: string): Promise<void> {
		let record = this.state.get(path);
		if (record && record.status !== "missing") {
			await this.state.markMissing(path);
		}
	}

	async recoverFromNote(file: TFile): Promise<PaperRecord | null> {
		let content = await this.app.vault.read(file);
		let itemKey = readFrontmatterScalar(content, "zotero_item_key") || "";
		let attachmentKey = readFrontmatterScalar(content, "zotero_attachment_key") || "";
		let pdfRaw = readFrontmatterScalar(content, "pdf") || "";

		if (!itemKey && !attachmentKey) {
			return null;
		}

		let pdfMatch = /\[\[(.*?)(?:\|.*)?\]\]/.exec(pdfRaw);
		let pdfPath = (pdfMatch?.[1] || pdfRaw).trim();
		if (!pdfPath) {
			return null;
		}

		await this.client.ensureConfigured(this.getVaultRoot());
		let metadataRes = await this.client.getItemMetadata({
			itemKey: itemKey || undefined,
			attachmentKey: attachmentKey || undefined,
		});
		if (!metadataRes?.metadata) {
			return null;
		}

		let adapter = this.requireFileSystemAdapter();
		let settings = this.getSettings();
		let pdfFile = this.app.vault.getAbstractFileByPath(pdfPath);
		let fingerprint: FileFingerprint | undefined;
		let status: PaperRecord["status"] = "complete";

		if (pdfFile instanceof TFile) {
			try {
				fingerprint = await this.fingerprintFile(adapter, pdfPath, settings, new AbortController().signal);
			}
			catch {
				status = "complete";
			}
		}
		else {
			status = "missing";
		}

		let record: PaperRecord = {
			path: pdfPath,
			status,
			attempts: 1,
			updatedAt: new Date().toISOString(),
			itemKey: metadataRes.itemKey,
			attachmentKey: metadataRes.attachmentKey,
			selectUri: metadataRes.selectUri,
			metadata: metadataRes.metadata,
			literatureNote: file.path,
			fingerprint,
		};

		await this.state.registerRecovered(record);
		return record;
	}

	async syncAnnotations(pathOrNotePath: string): Promise<{ path: string; count: number }> {
		let record = this.state.get(pathOrNotePath)
			|| this.state.findByLiteratureNote(pathOrNotePath);
		if (!record?.attachmentKey || !record?.metadata) {
			let file = this.app.vault.getAbstractFileByPath(pathOrNotePath);
			if (file instanceof TFile && file.extension.toLowerCase() === "md") {
				let recovered = await this.recoverFromNote(file).catch(() => null);
				if (recovered?.attachmentKey && recovered?.metadata) {
					record = recovered;
				}
			}
		}
		if (!record?.attachmentKey || !record?.metadata) {
			throw new Error("This file does not correspond to a recognized Zotero PDF.");
		}
		let settings = this.getSettings();
		let annotationsRes = await this.client.getAnnotations(record.attachmentKey, {
			exportImages: settings.exportAnnotationImages,
		});
		let note = await this.literatureNotes.createOrUpdate(record.path, record, annotationsRes.annotations);
		return { path: note.path, count: annotationsRes.annotations.length };
	}

	async syncAllAnnotationsWithPool(
		concurrency = 3,
		onProgress?: (done: number, total: number) => void,
	): Promise<{ synced: number; failed: number }> {
		let completed = this.state.allComplete().filter(r => r.status !== "missing");
		let total = completed.length;
		if (!total) {
			return { synced: 0, failed: 0 };
		}

		let done = 0;
		let synced = 0;
		let failed = 0;
		let queue = [...completed];

		let workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
			while (queue.length > 0) {
				let record = queue.shift();
				if (!record) break;
				try {
					await this.syncAnnotations(record.path);
					synced += 1;
				}
				catch (err) {
					failed += 1;
					console.error(`Failed syncing annotations for ${record.path}:`, err);
				}
				finally {
					done += 1;
					onProgress?.(done, total);
				}
			}
		});

		await Promise.all(workers);
		return { synced, failed };
	}

	async pruneMissing(): Promise<string[]> {
		let files = this.app.vault.getFiles();
		let existingPaths = new Set(files.map(f => f.path));
		return this.state.pruneMissing(existingPaths);
	}

	private async runImport(
		path: string,
		options: ImportOptions,
		signal: AbortSignal,
	): Promise<PaperRecord> {
		let initial = this.state.get(path);
		let beganProcessing = false;
		if (!initial) {
			await this.state.markNew(path);
		}

		try {
			let adapter = this.requireFileSystemAdapter();
			let settings = this.getSettings();
			let fingerprint = await this.fingerprintFile(adapter, path, settings, signal);
			this.throwIfCancelled(signal);

			if (initial?.status === "complete"
					&& initial.literatureNote
					&& sameFileContent(initial.fingerprint, fingerprint)
					&& !options.force) {
				await this.state.updateFingerprint(path, fingerprint);
				let untouched = this.state.get(path);
				if (!untouched) throw new Error("Fingerprint update lost the paper record.");
				return untouched;
			}

			let replacement = Boolean(initial?.fingerprint
				&& !sameFileContent(initial.fingerprint, fingerprint));
			await this.state.markProcessing(path);
			beganProcessing = true;

			await this.raceWithCancellation(
				this.client.ensureConfigured(this.getVaultRoot()),
				signal,
			);
			let result = await this.raceWithCancellation(
				this.client.importPdf(adapter.getFullPath(path), {
					replaceExisting: replacement,
					recognitionTimeoutMs: settings.recognitionTimeoutMs,
					expectedAttachmentKey: replacement ? initial?.attachmentKey : undefined,
				}),
				signal,
			);
			this.throwIfCancelled(signal);
			await this.state.markRecognized(path, result, fingerprint);
			let recognized = this.state.get(path);
			if (!recognized) {
				throw new Error("Zotero recognition completed without a persisted paper record.");
			}
			let annotations = (settings.syncAnnotationsOnImport && result.attachmentKey)
				? await this.client.getAnnotations(result.attachmentKey, { exportImages: settings.exportAnnotationImages })
					.then(res => res.annotations)
					.catch(() => [])
				: [];
			let note = await this.literatureNotes.createOrUpdate(path, recognized, annotations);
			await this.state.markLiteratureNote(path, note.path);
			await this.state.markComplete(path);
			let record = this.state.get(path);
			if (!record) {
				throw new Error("Import completed without a persisted paper record.");
			}
			return record;
		}
		catch (error) {
			let normalizedError = signal.aborted ? new ImportCancelledError() : error;
			let code = normalizedError instanceof ZoteroBridgeClientError
				? normalizedError.code
				: normalizedError instanceof ImportCancelledError
					? "import_cancelled"
					: normalizedError instanceof Error
						? normalizedError.name
						: "unknown_error";
			let message = normalizedError instanceof Error
				? normalizedError.message
				: "Unknown import error.";
			if (normalizedError instanceof ImportCancelledError || beganProcessing || !initial) {
				await this.state.markFailed(path, code, message);
			}
			throw normalizedError;
		}
	}

	private async fingerprintFile(
		adapter: FileSystemAdapter,
		path: string,
		settings: BridgeSettings,
		signal: AbortSignal,
	): Promise<FileFingerprint> {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			let stable = await waitForStableFile(
				async () => {
					let stat = await adapter.stat(path);
					return stat ? { size: stat.size, mtime: stat.mtime } : null;
				},
				{
					pollIntervalMs: settings.stablePollIntervalMs,
					requiredSamples: settings.stableRequiredSamples,
					timeoutMs: settings.stableTimeoutMs,
					signal,
				},
			);
			let content = await this.raceWithCancellation(adapter.readBinary(path), signal);
			let sha256 = await this.raceWithCancellation(sha256Hex(content), signal);
			let after = await adapter.stat(path);
			if (after && sameFileStat(stable, after)) {
				return { size: after.size, mtime: after.mtime, sha256 };
			}
		}
		throw new Error("The PDF kept changing while its content fingerprint was being calculated.");
	}

	private raceWithCancellation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
		if (signal.aborted) {
			return Promise.reject(new ImportCancelledError());
		}
		return new Promise<T>((resolve, reject) => {
			let onAbort = () => reject(new ImportCancelledError());
			signal.addEventListener("abort", onAbort, { once: true });
			operation.then(resolve, reject).finally(() => {
				signal.removeEventListener("abort", onAbort);
			});
		});
	}

	private throwIfCancelled(signal: AbortSignal): void {
		if (signal.aborted) {
			throw new ImportCancelledError();
		}
	}

	private requireFileSystemAdapter(): FileSystemAdapter {
		let adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("Zotero Vault Bridge requires a local desktop file-system vault.");
		}
		return adapter;
	}
}
