import archiver from "archiver";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
	copyFile,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const releaseDirectory = path.join(repositoryRoot, "dist", "release");
const fixedArchiveDate = new Date("1980-01-01T00:00:00.000Z");
const repositoryUrl = "https://github.com/chengcheng-cx/obsidian-zotero-vault-bridge";

assertInsideRepository(releaseDirectory);
const rootPackage = await readJson(path.join(repositoryRoot, "package.json"));
const obsidianPackage = await readJson(path.join(repositoryRoot, "obsidian-plugin", "package.json"));
const obsidianManifest = await readJson(path.join(repositoryRoot, "obsidian-plugin", "manifest.json"));
const obsidianVersions = await readJson(path.join(repositoryRoot, "obsidian-plugin", "versions.json"));
const companionPackage = await readJson(path.join(repositoryRoot, "zotero-companion", "package.json"));
const companionManifest = await readJson(path.join(repositoryRoot, "zotero-companion", "src", "manifest.json"));
const version = rootPackage.version;
let declaredVersions = [
	obsidianPackage.version,
	obsidianManifest.version,
	companionPackage.version,
	companionManifest.version,
];
if (declaredVersions.some(declared => declared !== version)) {
	throw new Error("Root, workspace package, Obsidian, and Zotero versions must match before packaging a release.");
}
if (obsidianVersions[version] !== obsidianManifest.minAppVersion) {
	throw new Error("versions.json must map the release version to manifest.minAppVersion.");
}

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const obsidianFiles = ["main.js", "manifest.json", "styles.css"];
for (let name of obsidianFiles) {
	await copyFile(
		path.join(repositoryRoot, "obsidian-plugin", name),
		path.join(releaseDirectory, name),
	);
}

const obsidianZipName = `obsidian-zotero-vault-bridge-${version}.zip`;
await writeDeterministicZip(
	path.join(releaseDirectory, obsidianZipName),
	obsidianFiles.map(name => ({
		name,
		path: path.join(repositoryRoot, "obsidian-plugin", name),
	})),
);

const xpiName = `zotero-vault-bridge-companion-${version}.xpi`;
const xpiSource = path.join(repositoryRoot, "zotero-companion", "dist", xpiName);
const xpiTarget = path.join(releaseDirectory, xpiName);
await copyFile(xpiSource, xpiTarget);
const xpiHash = await sha256File(xpiTarget);

const updateManifest = {
	addons: {
		[companionManifest.applications.zotero.id]: {
			updates: [{
				version,
				update_link: `${repositoryUrl}/releases/download/v${version}/${xpiName}`,
				update_hash: `sha256:${xpiHash}`,
				applications: {
					zotero: {
						strict_min_version: companionManifest.applications.zotero.strict_min_version,
						strict_max_version: companionManifest.applications.zotero.strict_max_version,
					},
				},
			}],
		},
	},
};
await writeFile(
	path.join(releaseDirectory, "updates.json"),
	`${JSON.stringify(updateManifest, null, 2)}\n`,
	"utf8",
);

let releaseFiles = (await readdir(releaseDirectory))
	.filter(name => name !== "SHA256SUMS.txt")
	.sort((left, right) => left.localeCompare(right, "en"));
let checksumLines = [];
for (let name of releaseFiles) {
	checksumLines.push(`${await sha256File(path.join(releaseDirectory, name))} *${name}`);
}
await writeFile(
	path.join(releaseDirectory, "SHA256SUMS.txt"),
	`${checksumLines.join("\n")}\n`,
	"utf8",
);

process.stdout.write(`${releaseDirectory}\n`);

async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, "utf8"));
}

async function sha256File(filePath) {
	let hash = createHash("sha256");
	hash.update(await readFile(filePath));
	return hash.digest("hex");
}

async function writeDeterministicZip(outputPath, files) {
	let output = createWriteStream(outputPath);
	let archive = archiver("zip", { forceLocalTime: false, zlib: { level: 9 } });
	let completed = new Promise((resolve, reject) => {
		output.on("close", resolve);
		output.on("error", reject);
		archive.on("error", reject);
	});
	archive.pipe(output);
	for (let file of [...files].sort((left, right) => left.name.localeCompare(right.name, "en"))) {
		archive.append(await readFile(file.path), {
			name: file.name,
			date: fixedArchiveDate,
			mode: 0o644,
		});
	}
	await archive.finalize();
	await completed;
}

function assertInsideRepository(target) {
	let relative = path.relative(repositoryRoot, target);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`Unsafe release output directory: ${target}`);
	}
}
