import { describe, expect, it } from "vitest";
import {
	createPartFileName,
	PART_SPLIT_BYTES,
	shouldSplitPart,
} from "@/shared/file-system";

describe("segmented capture files", () => {
	it("creates stable numbered MP4 part names", () => {
		const captureId = "12345678-1234-4000-8000-123456789abc";

		expect(createPartFileName("Demo.mp4", captureId, 1)).toBe(
			"Demo-12345678-part-001.mp4",
		);
		expect(createPartFileName("Demo.MP4", captureId, 1000)).toBe(
			"Demo-12345678-part-1000.mp4",
		);
	});

	it("splits only after reaching the 2 GiB soft threshold", () => {
		expect(shouldSplitPart(PART_SPLIT_BYTES - 1)).toBe(false);
		expect(shouldSplitPart(PART_SPLIT_BYTES)).toBe(true);
		expect(shouldSplitPart(PART_SPLIT_BYTES + 1)).toBe(true);
	});
});
