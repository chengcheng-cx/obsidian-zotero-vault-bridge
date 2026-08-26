import { describe, expect, it } from "vitest";
import { waitForStableFile } from "../src/papers/fileStability";

describe("waitForStableFile", () => {
	it("waits for the configured number of identical observations", async () => {
		let observations = [
			{ size: 10, mtime: 1 },
			{ size: 20, mtime: 2 },
			{ size: 20, mtime: 2 },
			{ size: 20, mtime: 2 },
		];
		let index = 0;
		let clock = 0;
		let result = await waitForStableFile(
			async () => observations[Math.min(index++, observations.length - 1)] ?? null,
			{ pollIntervalMs: 1, requiredSamples: 3, timeoutMs: 100 },
			async milliseconds => { clock += milliseconds; },
			() => clock,
		);
		expect(result).toEqual({ size: 20, mtime: 2 });
		expect(index).toBe(4);
	});
});
