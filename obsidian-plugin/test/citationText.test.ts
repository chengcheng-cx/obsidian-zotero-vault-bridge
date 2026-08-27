import { describe, expect, it } from "vitest";
import {
	citationMarkdown,
	findCitationTrigger,
	replaceCitationIfUnchanged,
} from "../src/citations/CitationText";

describe("citation autocomplete text", () => {
	it("finds an unfinished Pandoc citation at the cursor", () => {
		let line = "Evidence from [@Lovelace 2026";
		expect(findCitationTrigger(line, line.length)).toEqual({
			startCh: 14,
			endCh: line.length,
			query: "Lovelace 2026",
		});
	});

	it("opens on [@ but not after a completed citation", () => {
		expect(findCitationTrigger("See [@", 6)?.query).toBe("");
		expect(findCitationTrigger("See [@lovelace2026]", 20)).toBeNull();
		expect(findCitationTrigger("No citation", 11)).toBeNull();
	});

	it("creates a complete citation and rejects unsafe keys", () => {
		expect(citationMarkdown("lovelace2026analytical")).toBe("[@lovelace2026analytical]");
		expect(() => citationMarkdown("unsafe]key")).toThrow(/unsafe/i);
	});

	it("refuses to replace a trigger range that changed during async resolution", () => {
		let replacements = [] as string[];
		let editor = {
			getRange: () => "[@changed",
			replaceRange: (replacement: string) => replacements.push(replacement),
			setCursor: () => undefined,
		};
		let inserted = replaceCitationIfUnchanged(
			editor,
			{ line: 0, ch: 0 },
			{ line: 0, ch: 7 },
			"[@original",
			"lovelace2026analytical",
		);
		expect(inserted).toBe(false);
		expect(replacements).toEqual([]);
	});
});
