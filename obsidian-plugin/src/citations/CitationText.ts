import { isSafeCitationKey } from "../literature/NoteContent";

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

export function replaceCitationIfUnchanged(
	editor: CitationEditor,
	start: CitationPosition,
	end: CitationPosition,
	expectedTrigger: string,
	citationKey: string,
): boolean {
	if (editor.getRange(start, end) !== expectedTrigger) {
		return false;
	}
	let insertion = citationMarkdown(citationKey);
	editor.replaceRange(insertion, start, end);
	editor.setCursor({ line: start.line, ch: start.ch + insertion.length });
	return true;
}
