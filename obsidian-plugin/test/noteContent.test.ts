import { describe, expect, it } from "vitest";
import {
	literatureFrontmatter,
	isSafeCitationKey,
	readFrontmatterScalar,
	renderLiteratureTemplate,
	updateManagedFrontmatter,
	type LiteratureNoteContext,
} from "../src/literature/NoteContent";

function context(): LiteratureNoteContext {
	return {
		citationKey: "lovelace2026analytical",
		itemKey: "ITEM0001",
		attachmentKey: "ATTACH01",
		selectUri: "zotero://select/library/items/ITEM0001",
		pdfPath: "01_Papers/paper.pdf",
		metadata: {
			itemType: "journalArticle",
			title: "Analytical Engines & Notes",
			creators: [{
				firstName: "Ada",
				lastName: "Lovelace",
				name: "",
				creatorType: "author",
			}],
			date: "2026",
			year: "2026",
			publicationTitle: "Test \"Journal\"",
			doi: "10.0000/test",
			abstractNote: "Generated abstract.",
			url: "https://example.com",
			citationKey: "lovelace2026analytical",
		},
	};
}

describe("Literature Note content", () => {
	it("renders the configured template and escapes YAML placeholders", () => {
		let rendered = renderLiteratureTemplate([
			"---",
			"title: {{title_yaml}}",
			"authors:",
			"{{authors_yaml}}",
			"publication: {{publicationTitle_yaml}}",
			"zotero_select: {{zoteroSelect_yaml}}",
			"---",
			"# {{title}}",
			"{{abstract}}",
		].join("\n"), context());

		expect(rendered).toContain('title: "Analytical Engines & Notes"');
		expect(rendered).toContain('  - "Ada Lovelace"');
		expect(rendered).toContain('publication: "Test \\"Journal\\""');
		expect(rendered).toContain("# Analytical Engines & Notes");
		expect(rendered).toContain("Generated abstract.");
	});

	it("rejects citation keys that are unsafe Windows filenames", () => {
		expect(isSafeCitationKey("lovelace2026analytical")).toBe(true);
		expect(isSafeCitationKey("unsafe/key")).toBe(false);
		expect(isSafeCitationKey("CON")).toBe(false);
		expect(isSafeCitationKey("trailing.")).toBe(false);
	});

	it("updates managed frontmatter idempotently while preserving custom fields and body", () => {
		let original = [
			"---",
			"type: old",
			"custom_field: keep-me",
			"authors:",
			"  - Old Author",
			"zotero_item_key: OLD",
			"---",
			"# User heading",
			"",
			"User-owned comments stay unchanged.",
		].join("\n");
		let managed = literatureFrontmatter(context());
		let first = updateManagedFrontmatter(original, managed);
		let second = updateManagedFrontmatter(first, managed);

		expect(second).toBe(first);
		expect(first).toContain("custom_field: keep-me");
		expect(first.indexOf("custom_field: keep-me")).toBeLessThan(first.indexOf("authors:"));
		expect(first).toContain("# User heading\n\nUser-owned comments stay unchanged.");
		expect(first).toContain('zotero_item_key: "ITEM0001"');
		expect(readFrontmatterScalar(first, "zotero_item_key")).toBe("ITEM0001");
	});
});
