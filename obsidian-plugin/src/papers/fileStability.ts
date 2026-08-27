export interface FileStatSnapshot {
	size: number;
	mtime: number;
}

export interface StabilityOptions {
	pollIntervalMs: number;
	requiredSamples: number;
	timeoutMs: number;
	signal?: AbortSignal;
}

export class FileStabilityTimeoutError extends Error {
	constructor() {
		super("The PDF did not finish copying before the stability timeout.");
		this.name = "FileStabilityTimeoutError";
	}
}

export async function waitForStableFile(
	readStat: () => Promise<FileStatSnapshot | null>,
	options: StabilityOptions,
	delay: (milliseconds: number) => Promise<void> = milliseconds =>
		new Promise(resolve => window.setTimeout(resolve, milliseconds)),
	now: () => number = () => Date.now(),
): Promise<FileStatSnapshot> {
	let startedAt = now();
	let previous: FileStatSnapshot | null = null;
	let stableSamples = 0;

	while (now() - startedAt <= options.timeoutMs) {
		options.signal?.throwIfAborted();
		let current = await readStat();
		if (current && current.size > 0) {
			if (previous && current.size === previous.size && current.mtime === previous.mtime) {
				stableSamples += 1;
			}
			else {
				stableSamples = 1;
			}
			previous = current;
			if (stableSamples >= options.requiredSamples) {
				return current;
			}
		}
		else {
			previous = null;
			stableSamples = 0;
		}
		await delay(options.pollIntervalMs);
		options.signal?.throwIfAborted();
	}

	throw new FileStabilityTimeoutError();
}
