export interface BridgeStatus {
	success: true;
	companionVersion: string;
	zoteroVersion: string;
	configured: boolean;
	authenticated: boolean;
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
	itemKey: string;
	attachmentKey: string;
	metadata: RecognizedMetadata;
	selectUri: string;
}

export interface BridgeErrorPayload {
	success: false;
	error: string;
	message: string;
}
