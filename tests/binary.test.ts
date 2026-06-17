import { describe, expect, it } from "vitest";
import { base64ToArrayBuffer, blobToBase64 } from "@/shared/binary";

describe("binary helpers", () => {
	it("round-trips Blob data through base64", async () => {
		const source = new Uint8Array([0, 1, 2, 127, 128, 255]).buffer;
		const restored = base64ToArrayBuffer(
			await blobToBase64(new Blob([source])),
		);
		expect(Array.from(new Uint8Array(restored))).toEqual([
			0, 1, 2, 127, 128, 255,
		]);
	});
});
