import { describe, expect, it } from "vitest";
import {
	continueOnResolutionChange,
	recordingHudPosition,
} from "@/shared/settings";

describe("recordingHudPosition", () => {
	it("falls back to null when no value has been stored", async () => {
		expect(await recordingHudPosition.getValue()).toBeNull();
	});

	it("persists a set value", async () => {
		await recordingHudPosition.setValue({ left: 12, top: 34 });
		expect(await recordingHudPosition.getValue()).toEqual({
			left: 12,
			top: 34,
		});
	});
});

describe("continueOnResolutionChange", () => {
	it("falls back to true when no value has been stored", async () => {
		expect(await continueOnResolutionChange.getValue()).toBe(true);
	});

	it("persists a set value", async () => {
		await continueOnResolutionChange.setValue(false);
		expect(await continueOnResolutionChange.getValue()).toBe(false);
	});
});
