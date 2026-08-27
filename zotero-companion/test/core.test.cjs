const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("normalizes Windows paths and dot segments", () => {
	assert.equal(
		core.normalizePath("C:\\Research\\Vault\\01_Papers\\..\\paper.pdf", true),
		"c:/research/vault/paper.pdf",
	);
});

test("accepts a file inside a Windows vault root", () => {
	assert.equal(
		core.isPathInsideRoot(
			"C:\\Research\\Vault\\01_Papers\\paper.pdf",
			"c:\\research\\vault\\",
			true,
		),
		true,
	);
});

test("rejects sibling-prefix and traversal paths", () => {
	assert.equal(
		core.isPathInsideRoot("C:\\Research\\Vault-Other\\paper.pdf", "C:\\Research\\Vault", true),
		false,
	);
	assert.equal(
		core.isPathInsideRoot("C:\\Research\\Vault\\..\\secret.pdf", "C:\\Research\\Vault", true),
		false,
	);
});

test("handles POSIX roots without case folding", () => {
	assert.equal(core.isPathInsideRoot("/home/me/Vault/a.pdf", "/home/me/Vault", false), true);
	assert.equal(core.isPathInsideRoot("/home/me/vault/a.pdf", "/home/me/Vault", false), false);
});

test("compares tokens without prefix acceptance", () => {
	assert.equal(core.constantTimeEqual("abc", "abc"), true);
	assert.equal(core.constantTimeEqual("abc", "abcd"), false);
	assert.equal(core.constantTimeEqual("abc", "abd"), false);
});

test("extracts a four-digit year", () => {
	assert.equal(core.extractYear("2025-03-01"), "2025");
	assert.equal(core.extractYear("Spring 1998"), "1998");
	assert.equal(core.extractYear("forthcoming"), "");
});

test("generates a deterministic citation key from author, year, and title", () => {
	assert.equal(core.generateCitationKey({
		creators: [{ firstName: "Tasnim", lastName: "Abdel-Aty", creatorType: "author" }],
		year: "2025",
		title: "Evaluation of the Digital Product Passport",
	}, "ITEM0001"), "abdelaty2025evaluation");
	assert.equal(core.isSafeCitationKey("abdelaty2025evaluation"), true);
	assert.equal(core.isSafeCitationKey("unsafe/key"), false);
});

test("normalizes and ranks citation searches across author, year, title, and key", () => {
	const item = {
		citationKey: "lovelace2026analytical",
		title: "Analytical Engines and Notes",
		authors: ["Ada Lovelace"],
		year: "2026",
	};
	assert.equal(core.normalizeSearchText("  Áda—Lovelace "), "ada lovelace");
	assert.ok(core.citationSearchScore(item, "Ada 2026") >= 0);
	assert.ok(core.citationSearchScore(item, "lovelace2026") > core.citationSearchScore(item, "Engines"));
	assert.equal(core.citationSearchScore(item, "Turing"), -1);
});

test("bounds recognition timeouts", () => {
	assert.equal(core.recognitionTimeout(undefined), 120_000);
	assert.equal(core.recognitionTimeout(1), 10_000);
	assert.equal(core.recognitionTimeout(45_000), 45_000);
	assert.equal(core.recognitionTimeout(900_000), 600_000);
});
