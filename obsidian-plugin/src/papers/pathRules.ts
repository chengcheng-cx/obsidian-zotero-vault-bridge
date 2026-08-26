export function normalizeFolder(folder: string): string {
	return folder
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "")
		.replace(/\/{2,}/g, "/");
}

export function isPdfInFolder(path: string, extension: string, folder: string): boolean {
	let normalizedFolder = normalizeFolder(folder);
	if (!normalizedFolder || extension.toLocaleLowerCase("en-US") !== "pdf") {
		return false;
	}
	let normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
	return normalizedPath.startsWith(normalizedFolder + "/");
}
