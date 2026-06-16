import { describe, expect, it } from "vitest";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/shared/binary";

describe("binary helpers", () => {
	it("round-trips ArrayBuffer data through base64", () => {
		const source = new Uint8Array([0, 1, 2, 127, 128, 255]).buffer;
		const restored = base64ToArrayBuffer(arrayBufferToBase64(source));
		expect(Array.from(new Uint8Array(restored))).toEqual([
			0, 1, 2, 127, 128, 255,
		]);
	});
});
