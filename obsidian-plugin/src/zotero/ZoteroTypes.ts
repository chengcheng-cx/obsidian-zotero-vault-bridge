export interface BridgeStatus {
	success: true;
	companionVersion: string;
	zoteroVersion: string;
	configured: boolean;
	authenticated: boolean;
	pendingImports: number;
}

export interface ZoteroCreator {
	firstName: string;
	lastName: string;
	name: string;
	creatorType: string;
}

export interface RecognizedMetadata {
	itemType: string;
	title: string;
	creators: ZoteroCreator[];
	date: string;
	year: string;
	publicationTitle: string;
	doi: string;
	abstractNote: string;
	url: string;
	citationKey: string;
}

export interface ImportResult {
	success: true;
	alreadyImported: boolean;
	replacedExisting: boolean;
	itemKey: string;
	attachmentKey: string;
	metadata: RecognizedMetadata;
	selectUri: string;
}

export interface RelinkResult {
	success: true;
	attachmentKey: string;
	itemKey: string;
	oldPath: string;
	newPath: string;
}

export interface CitationSearchItem {
	itemKey: string;
	citationKey: string;
	title: string;
	authors: string[];
	year: string;
	selectUri: string;
}

export interface CitationSearchResult {
	success: true;
	items: CitationSearchItem[];
}

export interface CitationResolveResult {
	success: true;
	item: CitationSearchItem;
}

export interface BridgeErrorPayload {
	success: false;
	error: string;
	message: string;
}

export type AnnotationColorCategory = "yellow" | "red" | "green" | "blue" | "purple" | "orange" | "gray" | "other";

export interface ZoteroAnnotationItem {
	key: string;
	type: "highlight" | "note" | "image" | "underline" | string;
	text: string;
	comment: string;
	color: string;
	colorCategory: AnnotationColorCategory;
	pageLabel: string;
	sortIndex: string;
	tags: string[];
	selectUri: string;
	openPdfUri: string;
	imageBase64?: string;
}

export interface ZoteroAnnotationsResult {
	success: true;
	attachmentKey: string;
	itemKey: string;
	annotations: ZoteroAnnotationItem[];
}
