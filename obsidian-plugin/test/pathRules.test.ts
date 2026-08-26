import { describe, expect, it } from "vitest";
import { isPdfInFolder, normalizeFolder } from "../src/papers/pathRules";

describe("paper path rules", () => {
	it("normalizes a configured folder", () => {
		expect(normalizeFolder("/01_Papers\\Nested//")).toBe("01_Papers/Nested");
	});

	it("matches PDFs under the folder and rejects sibling prefixes", () => {
		expect(isPdfInFolder("01_Papers/paper.pdf", "pdf", "01_Papers")).toBe(true);
		expect(isPdfInFolder("01_Papers/nested/paper.PDF", "PDF", "01_Papers")).toBe(true);
		expect(isPdfInFolder("01_Papers-old/paper.pdf", "pdf", "01_Papers")).toBe(false);
		expect(isPdfInFolder("01_Papers/readme.md", "md", "01_Papers")).toBe(false);
	});
});
