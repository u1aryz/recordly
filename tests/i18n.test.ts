import { describe, expect, it } from "vitest";
import { t } from "@/utils/i18n";

describe("t", () => {
	it("returns the localized message for a known key", () => {
		expect(t("history")).toBe("履歴");
	});

	it("substitutes a single placeholder", () => {
		expect(t("recordingCount", "3")).toBe("録画中 3件");
	});

	it("substitutes multiple placeholders in order", () => {
		expect(
			t("stopReasonResolutionChangedWithDetails", ["640 x 480", "1280 x 720"]),
		).toBe(
			"動画の解像度が 640 x 480 から 1280 x 720 に変わったため自動停止しました",
		);
	});

	it("falls back to the key itself for an unknown key", () => {
		// biome-ignore lint/suspicious/noExplicitAny: intentionally testing an unknown key
		expect(t("thisKeyDoesNotExist" as any)).toBe("thisKeyDoesNotExist");
	});
});
