import { afterEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { t } from "@/utils/i18n";

const originalRuntimeId = fakeBrowser.runtime.id;

afterEach(() => {
	fakeBrowser.runtime.id = originalRuntimeId;
});

describe("t", () => {
	it("returns the localized message for a known key", () => {
		expect(t("history")).toBe("History");
	});

	it("substitutes a single placeholder", () => {
		expect(t("recordingCount", "3")).toBe("3 recording");
	});

	it("substitutes multiple placeholders in order", () => {
		expect(
			t("stopReasonResolutionChangedWithDetails", ["640 x 480", "1280 x 720"]),
		).toBe(
			"Stopped automatically because the video resolution changed from 640 x 480 to 1280 x 720",
		);
	});

	it("falls back to the key itself for an unknown key", () => {
		// biome-ignore lint/suspicious/noExplicitAny: intentionally testing an unknown key
		expect(t("thisKeyDoesNotExist" as any)).toBe("thisKeyDoesNotExist");
	});

	it("falls back to the key once the extension context is invalidated", () => {
		// Chrome clears runtime.id when the extension context is invalidated,
		// and i18n.getMessage would throw instead of returning a message.
		(fakeBrowser.runtime as { id?: string }).id = undefined;
		expect(t("history")).toBe("history");
	});
});
