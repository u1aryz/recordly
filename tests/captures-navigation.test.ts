import { describe, expect, it } from "vitest";
import { getAdjacentCaptureId } from "@/entrypoints/captures/App";
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
});
