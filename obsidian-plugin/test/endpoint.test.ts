import { describe, expect, it } from "vitest";
import { normalizeLoopbackEndpoint } from "../src/zotero/endpoint";

describe("normalizeLoopbackEndpoint", () => {
	it("accepts supported loopback hosts", () => {
		expect(normalizeLoopbackEndpoint("http://localhost:23119")).toBe("http://localhost:23119");
		expect(normalizeLoopbackEndpoint("http://127.0.0.1:23119/")).toBe("http://127.0.0.1:23119");
		expect(normalizeLoopbackEndpoint("http://[::1]:23119")).toBe("http://[::1]:23119");
	});

	it("rejects remote or credential-bearing endpoints", () => {
		expect(() => normalizeLoopbackEndpoint("https://example.com")).toThrow();
		expect(() => normalizeLoopbackEndpoint("http://example.com:23119")).toThrow();
		expect(() => normalizeLoopbackEndpoint("http://token@localhost:23119")).toThrow();
	});
});
