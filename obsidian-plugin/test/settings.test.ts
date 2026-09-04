import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../src/settings";

describe("bridge settings", () => {
	it("defaults legacy settings to clickable Literature Note links", () => {
		expect(loadSettings({ enableCitationAutocomplete: true }).citationInsertionMode)
			.toBe("literature-note-link");
	});

	it("preserves an explicit Pandoc insertion preference", () => {
		expect(loadSettings({ citationInsertionMode: "pandoc" }).citationInsertionMode)
			.toBe("pandoc");
	});

	it("rejects an unknown insertion mode", () => {
		expect(loadSettings({ citationInsertionMode: "html" }).citationInsertionMode)
			.toBe(DEFAULT_SETTINGS.citationInsertionMode);
	});

	it("defaults annotation sync and image export settings to true", () => {
		let settings = loadSettings({});
		expect(settings.syncAnnotationsOnImport).toBe(true);
		expect(settings.exportAnnotationImages).toBe(true);
	});

	it("preserves false settings for annotation sync and image export", () => {
		let settings = loadSettings({
			syncAnnotationsOnImport: false,
			exportAnnotationImages: false,
		});
		expect(settings.syncAnnotationsOnImport).toBe(false);
		expect(settings.exportAnnotationImages).toBe(false);
	});
});
