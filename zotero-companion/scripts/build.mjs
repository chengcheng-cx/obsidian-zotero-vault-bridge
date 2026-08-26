import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const sourceDirectory = path.join(packageDirectory, "src");
const distributionDirectory = path.join(packageDirectory, "dist");
const packageJson = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));

if (manifest.version !== packageJson.version) {
	throw new Error(`Version mismatch: package.json=${packageJson.version}, manifest.json=${manifest.version}`);
}

await rm(distributionDirectory, { recursive: true, force: true });
await mkdir(distributionDirectory, { recursive: true });
await cp(sourceDirectory, path.join(distributionDirectory, "unpacked"), { recursive: true });

const outputPath = path.join(
	distributionDirectory,
	`zotero-vault-bridge-companion-${packageJson.version}.xpi`,
);
const output = createWriteStream(outputPath);
const archive = archiver("zip", { zlib: { level: 9 } });

const completed = new Promise((resolve, reject) => {
	output.on("close", resolve);
	output.on("error", reject);
	archive.on("error", reject);
});

archive.pipe(output);
archive.directory(sourceDirectory, false);
await archive.finalize();
await completed;

process.stdout.write(`${outputPath}\n`);
