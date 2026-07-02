import { describe, expect, it } from "vitest";
import { isExtensionMessage } from "@/shared/message";

describe("isExtensionMessage", () => {
	it.each([
		"START_PICKER",
		"LIST_VIDEOS",
		"STOP_CAPTURE",
		"CAPTURE_STARTED",
		"CAPTURE_PROGRESS",
		"CAPTURE_FINISHED",
		"OPEN_CAPTURES",
		"DELETE_CAPTURE",
	])("returns true for type %s", (type) => {
		expect(isExtensionMessage({ type })).toBe(true);
	});

	it("returns false for an unknown type", () => {
		expect(isExtensionMessage({ type: "UNKNOWN" })).toBe(false);
	});

	it("returns false for null", () => {
		expect(isExtensionMessage(null)).toBe(false);
	});

	it("returns false for a non-object value", () => {
		expect(isExtensionMessage("START_PICKER")).toBe(false);
	});

	it("returns false for an object without a type", () => {
		expect(isExtensionMessage({})).toBe(false);
	});
});
