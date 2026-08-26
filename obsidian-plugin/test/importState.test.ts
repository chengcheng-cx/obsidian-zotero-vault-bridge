import { describe, expect, it } from "vitest";
import { ImportStateStore } from "../src/papers/ImportState";

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
			},
			"01_Papers/failed.pdf": {
				path: "01_Papers/failed.pdf",
				status: "failed",
				attempts: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		}, async () => undefined);

		expect(store.needsImport("01_Papers/processing.pdf", false)).toBe(true);
		expect(store.needsImport("01_Papers/complete.pdf", true)).toBe(false);
		expect(store.needsImport("01_Papers/failed.pdf", false)).toBe(false);
		expect(store.needsImport("01_Papers/failed.pdf", true)).toBe(true);
	});
});
