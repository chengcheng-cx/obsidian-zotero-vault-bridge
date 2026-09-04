import type { RecognizedMetadata, ZoteroAnnotationItem } from "../zotero/ZoteroTypes";

export interface LiteratureNoteContext {
	metadata: RecognizedMetadata;
	citationKey: string;
	itemKey: string;
	attachmentKey: string;
	selectUri: string;
	pdfPath: string;
}

export type ManagedFrontmatter = Record<string, string | string[]>;

const MANAGED_KEYS = [
	"type",
	"title",
	"authors",
	"year",
	"publication",
	"doi",
	"citation_key",
	"zotero_item_key",
	"zotero_attachment_key",
	"zotero_select",
	"pdf",
] as const;

const MANAGED_KEY_SET = new Set<string>(MANAGED_KEYS);

export function creatorDisplayName(creator: RecognizedMetadata["creators"][number]): string {
	if (creator.name.trim()) {
		return creator.name.trim();
	}
	return [creator.firstName, creator.lastName]
		.map(part => part.trim())
		.filter(Boolean)
		.join(" ");
}

export function literatureFrontmatter(context: LiteratureNoteContext): ManagedFrontmatter {
	let { metadata } = context;
	return {
		type: "literature",
		title: metadata.title,
		authors: metadata.creators.map(creatorDisplayName).filter(Boolean),
		year: metadata.year,
		publication: metadata.publicationTitle,
		doi: metadata.doi,
		citation_key: context.citationKey,
		zotero_item_key: context.itemKey,
		zotero_attachment_key: context.attachmentKey,
		zotero_select: context.selectUri,
		pdf: `[[${context.pdfPath}]]`,
	};
}

export function renderLiteratureTemplate(template: string, context: LiteratureNoteContext): string {
	let authors = context.metadata.creators.map(creatorDisplayName).filter(Boolean);
	let replacements: Record<string, string> = {
		title: context.metadata.title,
		title_yaml: yamlString(context.metadata.title),
		authors_yaml: authors.length
			? authors.map(author => `  - ${yamlString(author)}`).join("\n")
			: "  []",
		year: context.metadata.year,
		year_yaml: yamlString(context.metadata.year),
		publicationTitle: context.metadata.publicationTitle,
		publicationTitle_yaml: yamlString(context.metadata.publicationTitle),
		doi: context.metadata.doi,
		doi_yaml: yamlString(context.metadata.doi),
		citationKey: context.citationKey,
		citationKey_yaml: yamlString(context.citationKey),
		zoteroItemKey: context.itemKey,
		zoteroItemKey_yaml: yamlString(context.itemKey),
		attachmentKey: context.attachmentKey,
		attachmentKey_yaml: yamlString(context.attachmentKey),
		zoteroSelect: context.selectUri,
		zoteroSelect_yaml: yamlString(context.selectUri),
		pdfPath: context.pdfPath,
		pdf_yaml: yamlString(`[[${context.pdfPath}]]`),
		abstract: context.metadata.abstractNote,
	};

	let rendered = template;
	for (let [name, value] of Object.entries(replacements)) {
		rendered = rendered.replace(new RegExp(`{{${name}}}`, "g"), () => value);
	}
	return rendered;
}

export function updateManagedFrontmatter(
	content: string,
	managed: ManagedFrontmatter,
): string {
	let parsed = splitFrontmatter(content);
	let updatedLines: string[] = [];
	let seen = new Set<string>();
	for (let index = 0; index < parsed.frontmatterLines.length;) {
		let line = parsed.frontmatterLines[index] ?? "";
		let keyMatch = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
		let key = keyMatch?.[1] ?? "";
		if (!MANAGED_KEY_SET.has(key)) {
			updatedLines.push(line);
			index += 1;
			continue;
		}

		if (!seen.has(key)) {
			updatedLines.push(...serializeManagedField(key, managed[key] ?? ""));
			seen.add(key);
		}
		index = managedBlockEnd(parsed.frontmatterLines, index);
	}

	let missingLines = MANAGED_KEYS
		.filter(key => !seen.has(key))
		.flatMap(key => serializeManagedField(key, managed[key] ?? ""));
	let trailingBlankLines: string[] = [];
	while (updatedLines.length && !updatedLines.at(-1)?.trim()) {
		trailingBlankLines.unshift(updatedLines.pop() ?? "");
	}
	let frontmatterLines = [...updatedLines, ...missingLines, ...trailingBlankLines];
	return [
		"---",
		...frontmatterLines,
		"---",
		parsed.body,
	].join(parsed.newline);
}

export function readFrontmatterScalar(content: string, key: string): string | undefined {
	let parsed = splitFrontmatter(content);
	for (let line of parsed.frontmatterLines) {
		let match = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
		if (!match || match[1] !== key) {
			continue;
		}
		let raw = match[2] ?? "";
		if (!raw) {
			return "";
		}
		try {
			let value = JSON.parse(raw) as unknown;
			return typeof value === "string" ? value : String(value);
		}
		catch {
			return raw.replace(/^['"]|['"]$/g, "");
		}
	}
	return undefined;
}

export function isSafeCitationKey(value: string): boolean {
	return /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u.test(value)
		&& !/[. ]$/.test(value)
		&& !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

function serializeManagedField(key: string, value: string | string[]): string[] {
	if (Array.isArray(value)) {
		if (!value.length) {
			return [`${key}: []`];
		}
		return [
			`${key}:`,
			...value.map(entry => `  - ${yamlString(entry)}`),
		];
	}
	return [`${key}: ${yamlString(value)}`];
}

function managedBlockEnd(lines: string[], start: number): number {
	let end = start + 1;
	while (end < lines.length) {
		let line = lines[end] ?? "";
		if (!/^[ \t]+/.test(line) && line.trim()) {
			break;
		}
		end += 1;
	}
	while (end > start + 1 && !(lines[end - 1] ?? "").trim()) {
		end -= 1;
	}
	return end;
}

function splitFrontmatter(content: string): {
	frontmatterLines: string[];
	body: string;
	newline: "\n" | "\r\n";
} {
	let newline: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n";
	let lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") {
		return { frontmatterLines: [], body: content, newline };
	}
	let closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (closingIndex < 0) {
		return { frontmatterLines: [], body: content, newline };
	}
	return {
		frontmatterLines: lines.slice(1, closingIndex),
		body: lines.slice(closingIndex + 1).join(newline),
		newline,
	};
}

function yamlString(value: string): string {
	return JSON.stringify(value.replace(/\r?\n/g, " "));
}

export class MalformedAnnotationMarkersError extends Error {
	constructor(message = "Annotation markers in this note are malformed (unpaired tags). Modification was aborted to protect hand-written notes.") {
		super(message);
		this.name = "MalformedAnnotationMarkersError";
	}
}

export const ANNOTATIONS_START = "<!-- BEGIN ANNOTATIONS -->";
export const ANNOTATIONS_END = "<!-- END ANNOTATIONS -->";
const ANNOTATIONS_GUARD = "<!-- ⚠️ 此區塊由 Zotero 同步維護，手動編輯將在下次同步時被覆寫，個人心得請撰寫於區塊之外 -->";

const CALLOUT_MAP: Record<string, string> = {
	yellow: "quote",
	red: "danger",
	green: "tip",
	blue: "note",
	purple: "question",
	orange: "warning",
	gray: "note",
};

export function formatAnnotations(annotations: ZoteroAnnotationItem[], citationKey: string): string {
	let lines: string[] = [ANNOTATIONS_START, ANNOTATIONS_GUARD];

	if (!annotations.length) {
		lines.push(
			"> [!info] 尚無劃線註解",
			"> 在 Zotero 閱讀器中對此 PDF 劃線或新增批註後，執行「Sync annotations」即可同步至此處。",
		);
	}
	else {
		for (let anno of annotations) {
			let callout = CALLOUT_MAP[anno.colorCategory] || "quote";
			let pageText = anno.pageLabel ? `p. ${anno.pageLabel}` : "PDF";
			let title = `> [!${callout}]+ ${pageText} ([Zotero](${anno.openPdfUri}))`;
			lines.push(title);

			if (anno.type === "image") {
				lines.push(`> ![[assets/${citationKey}/${anno.key}.png]]`);
			}
			if (anno.text) {
				let quotedText = anno.text.replace(/\r?\n/g, "\n> ");
				lines.push(`> ${quotedText}`);
			}
			if (anno.comment) {
				let quotedComment = anno.comment.replace(/\r?\n/g, "\n> ");
				lines.push(`>\n> **Comment**: ${quotedComment}`);
			}
			if (anno.tags && anno.tags.length) {
				let tagsText = anno.tags.map(t => `#${t}`).join(" ");
				lines.push(`>\n> ${tagsText}`);
			}
			lines.push("");
		}
		if (lines[lines.length - 1] === "") {
			lines.pop();
		}
	}

	lines.push(ANNOTATIONS_END);
	return lines.join("\n");
}

export function updateManagedAnnotations(content: string, renderedAnnotationsBlock: string): string {
	let parsed = splitFrontmatter(content);
	let body = parsed.body;
	let newline = parsed.newline;

	let startIndex = body.indexOf(ANNOTATIONS_START);
	let endIndex = body.indexOf(ANNOTATIONS_END);

	let hasStart = startIndex >= 0;
	let hasEnd = endIndex >= 0;

	if (hasStart !== hasEnd || (hasStart && hasEnd && endIndex < startIndex)) {
		throw new MalformedAnnotationMarkersError();
	}

	if (hasStart && hasEnd) {
		let before = body.slice(0, startIndex);
		let after = body.slice(endIndex + ANNOTATIONS_END.length);
		let newBody = before + renderedAnnotationsBlock + after;
		return rejoinNote(parsed.frontmatterLines, newBody, newline);
	}

	let abstractMatch = /(?:^|\n)(##\s+Abstract[\s\S]*?)(?=(?:\n##\s+)|$)/.exec(body);
	let newBody: string;
	if (abstractMatch && abstractMatch.index >= 0) {
		let insertPos = abstractMatch.index + abstractMatch[0].length;
		let before = body.slice(0, insertPos).replace(/\s+$/, "");
		let after = body.slice(insertPos).replace(/^\s+/, "");
		newBody = `${before}\n\n## Annotations\n\n${renderedAnnotationsBlock}\n\n${after}`;
	}
	else {
		newBody = body.trimEnd() + `\n\n## Annotations\n\n${renderedAnnotationsBlock}\n`;
	}

	return rejoinNote(parsed.frontmatterLines, newBody, newline);
}

function rejoinNote(frontmatterLines: string[], body: string, newline: "\n" | "\r\n"): string {
	if (!frontmatterLines.length) {
		return body;
	}
	return ["---", ...frontmatterLines, "---", body].join(newline);
}
