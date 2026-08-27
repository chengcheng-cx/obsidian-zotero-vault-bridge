export class App {}

export class FileSystemAdapter {}

export class PluginSettingTab {
	constructor(..._args: unknown[]) {}
}

export class Setting {}

export function normalizePath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\.\//, "");
}

export async function requestUrl(): Promise<never> {
	throw new Error("Unexpected Obsidian HTTP request in a unit test.");
}
