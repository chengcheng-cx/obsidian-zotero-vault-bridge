import type { FileStatSnapshot } from "./fileStability";

export interface FileFingerprint extends FileStatSnapshot {
	sha256: string;
}

export function isValidFingerprint(value: unknown): value is FileFingerprint {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	let candidate = value as Partial<FileFingerprint>;
	return Number.isFinite(candidate.size)
		&& (candidate.size ?? -1) >= 0
		&& Number.isFinite(candidate.mtime)
		&& (candidate.mtime ?? -1) >= 0
		&& typeof candidate.sha256 === "string"
		&& /^[a-f0-9]{64}$/i.test(candidate.sha256);
}

export function sameFileStat(
	left: Pick<FileStatSnapshot, "size" | "mtime"> | undefined,
	right: Pick<FileStatSnapshot, "size" | "mtime"> | undefined,
): boolean {
	return Boolean(left && right && left.size === right.size && left.mtime === right.mtime);
}

export function sameFileContent(
	left: FileFingerprint | undefined,
	right: FileFingerprint | undefined,
): boolean {
	return Boolean(left && right && left.sha256.toLowerCase() === right.sha256.toLowerCase());
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
	let digest = await globalThis.crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
