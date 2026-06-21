import { describe, expect, it } from "vitest";
import {
	getAdjacentCaptureId,
	getPageHost,
	isCaptureDeleteKey,
} from "@/entrypoints/captures/App";
import type { CaptureMetadata } from "@/shared/types";

const captures = [
	{ id: "newest" },
	{ id: "middle" },
	{ id: "oldest" },
] as CaptureMetadata[];

describe("captures keyboard navigation", () => {
	it("moves the selection with the up and down arrow keys", () => {
		expect(getAdjacentCaptureId(captures, "middle", "ArrowUp")).toBe("newest");
		expect(getAdjacentCaptureId(captures, "middle", "ArrowDown")).toBe(
			"oldest",
		);
	});

	it("stays at the first and last capture", () => {
		expect(getAdjacentCaptureId(captures, "newest", "ArrowUp")).toBe("newest");
		expect(getAdjacentCaptureId(captures, "oldest", "ArrowDown")).toBe(
			"oldest",
		);
	});

	it("uses the first capture when the current selection is missing", () => {
		expect(getAdjacentCaptureId(captures, null, "ArrowDown")).toBe("middle");
		expect(getAdjacentCaptureId([], null, "ArrowDown")).toBeNull();
	});

	it("recognizes delete keys on Mac and other keyboards", () => {
		expect(isCaptureDeleteKey("Backspace")).toBe(true);
		expect(isCaptureDeleteKey("Delete")).toBe(true);
		expect(isCaptureDeleteKey("Enter")).toBe(false);
	});

	it("shows the host for valid page URLs", () => {
		expect(getPageHost("https://example.test/watch?v=1")).toBe("example.test");
	});

	it("keeps an invalid page URL unchanged", () => {
		expect(getPageHost("unknown page")).toBe("unknown page");
	});
});
