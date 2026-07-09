import { describe, expect, it } from "vitest";
import { getToolbarPosition } from "@/entrypoints/content/VideoPickerOverlay";

describe("getToolbarPosition", () => {
	const toolbarSize = { width: 120, height: 40 };

	it("places the toolbar just above the selected video", () => {
		expect(
			getToolbarPosition({ left: 100, top: 200 }, toolbarSize, 1000),
		).toEqual({ left: 100, top: 152 });
	});

	it("clamps against the right edge of the viewport", () => {
		expect(
			getToolbarPosition({ left: 900, top: 200 }, toolbarSize, 1000),
		).toEqual({ left: 872, top: 152 });
	});

	it("clamps against the left edge of the viewport", () => {
		expect(
			getToolbarPosition({ left: -50, top: 200 }, toolbarSize, 1000),
		).toEqual({ left: 8, top: 152 });
	});

	it("keeps the toolbar inside the viewport for a video near the top", () => {
		expect(
			getToolbarPosition({ left: 100, top: 10 }, toolbarSize, 1000),
		).toEqual({ left: 100, top: 8 });
	});

	it("honors a custom margin", () => {
		expect(
			getToolbarPosition({ left: 0, top: 0 }, toolbarSize, 1000, 4),
		).toEqual({ left: 4, top: 4 });
	});
});
