import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const releaseDirectory = path.join(repositoryRoot, "dist", "release");
const npmEntrypoint = process.env.npm_execpath;

runBuild();
const first = await artifactHashes();
runBuild();
const second = await artifactHashes();

if (JSON.stringify(first) !== JSON.stringify(second)) {
	throw new Error(`Release artifacts are not reproducible.\nFirst: ${JSON.stringify(first)}\nSecond: ${JSON.stringify(second)}`);
}
process.stdout.write(`Reproducible release verified for ${Object.keys(second).length} files.\n`);

function runBuild() {
	let command = npmEntrypoint ? process.execPath : "npm";
	let arguments_ = npmEntrypoint
		? [npmEntrypoint, "run", "build:release"]
		: ["run", "build:release"];
	let result = spawnSync(command, arguments_, {
		cwd: repositoryRoot,
		encoding: "utf8",
		stdio: "inherit",
	});
	if (result.status !== 0) {
		throw new Error(`Release build failed with exit code ${result.status}.`);
	}
}

async function artifactHashes() {
	let hashes = {};
	let names = (await readdir(releaseDirectory)).sort((left, right) => left.localeCompare(right, "en"));
	for (let name of names) {
		let hash = createHash("sha256");
		hash.update(await readFile(path.join(releaseDirectory, name)));
		hashes[name] = hash.digest("hex");
	}
	return hashes;
}
