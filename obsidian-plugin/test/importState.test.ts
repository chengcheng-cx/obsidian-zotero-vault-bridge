import { describe, expect, it } from "vitest";
import { ImportStateStore } from "../src/papers/ImportState";

const FINGERPRINT = { size: 100, mtime: 200, sha256: "a".repeat(64) };

describe("ImportStateStore", () => {
	it("recovers an interrupted processing record but skips completed and failed records by default", () => {
		let store = new ImportStateStore({
			"01_Papers/processing.pdf": {
				path: "01_Papers/processing.pdf",
				status: "processing",
				attempts: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			"01_Papers/complete.pdf": {
				path: "01_Papers/complete.pdf",
				status: "complete",
				attempts: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
				literatureNote: "02_Literature/complete2026paper.md",
				fingerprint: FINGERPRINT,
			},
			"01_Papers/missing-note.pdf": {
				path: "01_Papers/missing-note.pdf",
				status: "complete",
				attempts: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			"01_Papers/failed.pdf": {
				path: "01_Papers/failed.pdf",
				status: "failed",
				attempts: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		}, async () => undefined);

		expect(store.needsImport("01_Papers/processing.pdf", false)).toBe(true);
		expect(store.needsImport("01_Papers/complete.pdf", true, FINGERPRINT)).toBe(false);
		expect(store.needsImport("01_Papers/complete.pdf", false, { size: 100, mtime: 201 })).toBe(true);
		expect(store.needsImport("01_Papers/missing-note.pdf", false)).toBe(true);
		expect(store.needsImport("01_Papers/failed.pdf", false)).toBe(false);
		expect(store.needsImport("01_Papers/failed.pdf", true)).toBe(true);
	});

	it("moves a record and preserves its fingerprint", async () => {
		let persisted = 0;
		let store = new ImportStateStore({
			"01_Papers/old.pdf": {
				path: "01_Papers/old.pdf",
				status: "complete",
				attempts: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
				literatureNote: "02_Literature/key.md",
				fingerprint: FINGERPRINT,
			},
		}, async () => { persisted += 1; });

		let moved = await store.move("01_Papers/old.pdf", "01_Papers/new.pdf", undefined, "recognized");
		expect(moved.path).toBe("01_Papers/new.pdf");
		expect(moved.fingerprint).toEqual(FINGERPRINT);
		expect(store.get("01_Papers/old.pdf")).toBeUndefined();
		expect(store.get("01_Papers/new.pdf")?.status).toBe("recognized");
		expect(persisted).toBe(1);
	});

	it("refuses to overwrite destination state during a move", async () => {
		let record = {
			path: "01_Papers/old.pdf",
			status: "complete" as const,
			attempts: 1,
			updatedAt: "2026-01-01T00:00:00.000Z",
			literatureNote: "02_Literature/key.md",
			fingerprint: FINGERPRINT,
		};
		let store = new ImportStateStore({
			"01_Papers/old.pdf": record,
			"01_Papers/new.pdf": { ...record, path: "01_Papers/new.pdf" },
		}, async () => undefined);

		await expect(store.move("01_Papers/old.pdf", "01_Papers/new.pdf"))
			.rejects.toThrow(/existing record/i);
		expect(store.get("01_Papers/old.pdf")).toBeDefined();
		expect(store.get("01_Papers/new.pdf")).toBeDefined();
	});
});
