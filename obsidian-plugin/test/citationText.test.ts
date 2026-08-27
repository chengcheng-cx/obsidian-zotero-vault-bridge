import { describe, expect, it } from "vitest";
import {
	citationInsertion,
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

	it("creates a clickable Literature Note link with the citation as its alias", () => {
		expect(citationInsertion(
			"lovelace2026analytical",
			"literature-note-link",
			"02_Literature",
		)).toBe("[[02_Literature/lovelace2026analytical|[@lovelace2026analytical]]]");
		expect(citationInsertion(
			"lovelace2026analytical",
			"pandoc",
			"02_Literature",
		)).toBe("[@lovelace2026analytical]");
	});

	it("links to the Zotero item instead of creating a dangling Literature Note link", () => {
		expect(citationInsertion(
			"lovelace2026analytical",
			"literature-note-link",
			"02_Literature",
			{
				literatureNoteExists: false,
				zoteroSelectUri: "zotero://select/library/items/ABCD1234",
			},
		)).toBe("[@lovelace2026analytical](zotero://select/library/items/ABCD1234)");
		expect(() => citationInsertion(
			"lovelace2026analytical",
			"literature-note-link",
			"02_Literature",
			{
				literatureNoteExists: false,
				zoteroSelectUri: "https://example.com/unsafe",
			},
		)).toThrow(/unsafe/i);
	});

	it("rejects an unsafe Literature Note link target", () => {
		expect(() => citationInsertion(
			"lovelace2026analytical",
			"literature-note-link",
			"../Outside",
		)).toThrow(/not safe/i);
		expect(() => citationInsertion(
			"lovelace2026analytical",
			"literature-note-link",
			"Notes|alias",
		)).toThrow(/characters/i);
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

	it("replaces an unchanged trigger with a clickable Literature Note link", () => {
		let replacement = "";
		let cursor = { line: -1, ch: -1 };
		let editor = {
			getRange: () => "[@love",
			replaceRange: (value: string) => { replacement = value; },
			setCursor: (value: { line: number; ch: number }) => { cursor = value; },
		};
		let inserted = replaceCitationIfUnchanged(
			editor,
			{ line: 2, ch: 4 },
			{ line: 2, ch: 10 },
			"[@love",
			"lovelace2026analytical",
			"literature-note-link",
			"02_Literature",
		);
		expect(inserted).toBe(true);
		expect(replacement).toBe("[[02_Literature/lovelace2026analytical|[@lovelace2026analytical]]]");
		expect(cursor).toEqual({ line: 2, ch: 70 });
	});
});
