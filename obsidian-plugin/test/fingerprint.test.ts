import { describe, expect, it } from "vitest";
import {
	isValidFingerprint,
	sameFileContent,
	sameFileStat,
	sha256Hex,
} from "../src/papers/fingerprint";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("file fingerprints", () => {
	it("distinguishes stat changes from content changes", () => {
		let first = { size: 10, mtime: 100, sha256: HASH_A };
		let touched = { size: 10, mtime: 200, sha256: HASH_A };
		let replaced = { size: 10, mtime: 200, sha256: HASH_B };

		expect(sameFileStat(first, touched)).toBe(false);
		expect(sameFileContent(first, touched)).toBe(true);
		expect(sameFileContent(first, replaced)).toBe(false);
	});

	it("rejects malformed persisted fingerprints", () => {
		expect(isValidFingerprint({ size: 1, mtime: 2, sha256: HASH_A })).toBe(true);
		expect(isValidFingerprint({ size: 1, mtime: 2, sha256: "secret" })).toBe(false);
	});

	it("calculates the standard SHA-256 digest", async () => {
		let bytes = new TextEncoder().encode("abc");
		expect(await sha256Hex(bytes.buffer)).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
