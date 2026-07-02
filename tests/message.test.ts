import { describe, expect, it } from "vitest";
import {
	isCaptureStreamPortMessage,
	isExtensionMessage,
} from "@/shared/message";

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

describe("isCaptureStreamPortMessage", () => {
	it.each([
		"CAPTURE_STARTED",
		"CAPTURE_PROGRESS",
		"CAPTURE_FINISHED",
	])("returns true for type %s", (type) => {
		expect(isCaptureStreamPortMessage({ type })).toBe(true);
	});

	it("returns false for a type outside the port message union", () => {
		expect(isCaptureStreamPortMessage({ type: "LIST_VIDEOS" })).toBe(false);
	});

	it("returns false for null", () => {
		expect(isCaptureStreamPortMessage(null)).toBe(false);
	});

	it("returns false for a non-object value", () => {
		expect(isCaptureStreamPortMessage("CAPTURE_STARTED")).toBe(false);
	});
});
