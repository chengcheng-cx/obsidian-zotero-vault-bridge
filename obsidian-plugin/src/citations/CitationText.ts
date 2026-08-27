import { isSafeCitationKey } from "../literature/NoteContent";
import type { CitationInsertionMode } from "../settings";

export interface CitationTrigger {
	startCh: number;
	endCh: number;
	query: string;
}

export interface CitationPosition {
	line: number;
	ch: number;
}

export interface CitationEditor {
	getRange(from: CitationPosition, to: CitationPosition): string;
	replaceRange(replacement: string, from: CitationPosition, to?: CitationPosition): void;
	setCursor(position: CitationPosition): void;
}

export interface CitationInsertionOptions {
	literatureNoteExists?: boolean;
	zoteroSelectUri?: string;
}

export function findCitationTrigger(line: string, cursorCh: number): CitationTrigger | null {
	if (!Number.isInteger(cursorCh) || cursorCh < 2 || cursorCh > line.length) {
		return null;
	}
	let beforeCursor = line.slice(0, cursorCh);
	let match = /\[@([^\[\]\r\n]*)$/u.exec(beforeCursor);
	if (!match || match.index < 0) {
		return null;
	}
	let query = (match[1] ?? "").trim();
	if (query.length > 200) {
		return null;
	}
	return {
		startCh: match.index,
		endCh: cursorCh,
		query,
	};
}

export function citationMarkdown(citationKey: string): string {
	if (!isSafeCitationKey(citationKey)) {
		throw new Error("Zotero returned a citation key that is unsafe to insert.");
	}
	return `[@${citationKey}]`;
}

export function citationInsertion(
	citationKey: string,
	mode: CitationInsertionMode,
	literatureFolder: string,
	options: CitationInsertionOptions = {},
): string {
	let citation = citationMarkdown(citationKey);
	if (mode === "pandoc") {
		return citation;
	}
	if (options.literatureNoteExists === false) {
		let selectUri = options.zoteroSelectUri ?? "";
		if (!/^zotero:\/\/select\/library\/items\/[A-Z0-9]{8}$/u.test(selectUri)) {
			throw new Error("Zotero returned a select link that is unsafe to insert.");
		}
		return `[@${citationKey}](${selectUri})`;
	}
	let folder = literatureFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (!folder || folder.split("/").some(segment => !segment || segment === "." || segment === "..")) {
		throw new Error("The Literature Notes folder is not safe to use in a citation link.");
	}
	if (/[\[\]|#^]/u.test(folder)) {
		throw new Error("The Literature Notes folder contains characters that cannot be used in a citation link.");
	}
	return `[[${folder}/${citationKey}|${citation}]]`;
}

export function replaceCitationIfUnchanged(
	editor: CitationEditor,
	start: CitationPosition,
	end: CitationPosition,
	expectedTrigger: string,
	citationKey: string,
	mode: CitationInsertionMode = "pandoc",
	literatureFolder = "02_Literature",
	options: CitationInsertionOptions = {},
): boolean {
	if (editor.getRange(start, end) !== expectedTrigger) {
		return false;
	}
	let insertion = citationInsertion(citationKey, mode, literatureFolder, options);
	editor.replaceRange(insertion, start, end);
	editor.setCursor({ line: start.line, ch: start.ch + insertion.length });
	return true;
}
