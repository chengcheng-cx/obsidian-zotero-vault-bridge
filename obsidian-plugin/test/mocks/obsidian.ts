export class FileSystemAdapter {}

export async function requestUrl(): Promise<never> {
	throw new Error("Unexpected Obsidian HTTP request in a unit test.");
}
