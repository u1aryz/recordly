import { afterEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { isExtensionContextValid } from "@/shared/extension-context";

const originalRuntimeId = fakeBrowser.runtime.id;

afterEach(() => {
	fakeBrowser.runtime.id = originalRuntimeId;
});

describe("isExtensionContextValid", () => {
	it("returns true while runtime.id is available", () => {
		expect(isExtensionContextValid()).toBe(true);
	});

	it("returns false once runtime.id is gone", () => {
		// Chrome clears runtime.id when the extension context is invalidated.
		(fakeBrowser.runtime as { id?: string }).id = undefined;
		expect(isExtensionContextValid()).toBe(false);
	});
});
