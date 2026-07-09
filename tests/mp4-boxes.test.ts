import { describe, expect, it } from "vitest";
import {
	concatBytes,
	fourCc,
	i32,
	i32Array,
	makeBox,
	makeFullBox,
	peekBox,
	readBoxBytes,
	readBoxHeader,
	readFourCc,
	readI32,
	readU32,
	readU64,
	splitChildBoxes,
	u32,
	u32Array,
	u64,
	u64Array,
} from "@/shared/mp4-boxes";

describe("byte helpers", () => {
	it("round-trips u32/i32 values", () => {
		expect(readU32(u32(0), 0)).toBe(0);
		expect(readU32(u32(0xffffffff), 0)).toBe(0xffffffff);
		expect(readI32(i32(-1), 0)).toBe(-1);
		expect(readI32(i32(-2147483648), 0)).toBe(-2147483648);
	});

	it("round-trips u64 values within the safe integer range", () => {
		expect(readU64(u64(0), 0)).toBe(0);
		expect(readU64(u64(Number.MAX_SAFE_INTEGER), 0)).toBe(
			Number.MAX_SAFE_INTEGER,
		);
	});

	it("rejects u64 values beyond the safe integer range", () => {
		const bytes = new Uint8Array(8).fill(0xff);
		expect(readU64(bytes, 0)).toBeUndefined();
	});

	it("round-trips four-character codes", () => {
		expect(readFourCc(fourCc("moov"), 0)).toBe("moov");
	});

	it("packs value tables into contiguous buffers", () => {
		expect(Array.from(u32Array([1, 0xffffffff]))).toEqual([
			0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff,
		]);
		expect(Array.from(i32Array([-1, 2]))).toEqual([
			0xff, 0xff, 0xff, 0xff, 0, 0, 0, 2,
		]);
		expect(Array.from(u64Array([1]))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
		expect(u32Array([]).length).toBe(0);
	});

	it("packs tables far beyond the spread-argument limit", () => {
		const values = new Array(500_000).fill(7);
		const packed = u32Array(values);
		expect(packed.length).toBe(2_000_000);
		expect(readU32(packed, 1_999_996)).toBe(7);
	});

	it("concatenates byte arrays in order", () => {
		expect(Array.from(concatBytes([u32(1), fourCc("free")]))).toEqual([
			0, 0, 0, 1, 0x66, 0x72, 0x65, 0x65,
		]);
	});
});

describe("makeBox", () => {
	it("wraps payloads with a size-prefixed header", () => {
		const box = makeBox("free", new Uint8Array([1, 2, 3]));
		expect(box.length).toBe(11);
		expect(readU32(box, 0)).toBe(11);
		expect(readFourCc(box, 4)).toBe("free");
		expect(Array.from(box.subarray(8))).toEqual([1, 2, 3]);
	});

	it("prefixes full boxes with version and flags", () => {
		const box = makeFullBox("tfhd", 1, 0x020020, u32(7));
		expect(readU32(box, 8)).toBe((1 << 24) | 0x020020);
		expect(readU32(box, 12)).toBe(7);
	});
});

describe("readBoxHeader", () => {
	it("parses a compact box header", () => {
		const box = makeBox("moov", new Uint8Array(4));
		const header = readBoxHeader(box, 0, box.length);
		expect(header).toEqual({ type: "moov", start: 0, headerSize: 8, size: 12 });
	});

	it("parses a large-size box header", () => {
		const box = concatBytes([
			u32(1),
			fourCc("mdat"),
			u64(24),
			new Uint8Array(8),
		]);
		const header = readBoxHeader(box, 0, box.length);
		expect(header).toEqual({
			type: "mdat",
			start: 0,
			headerSize: 16,
			size: 24,
		});
	});

	it("rejects boxes that extend past the region", () => {
		const box = concatBytes([u32(100), fourCc("mdat")]);
		expect(readBoxHeader(box, 0, box.length)).toBeUndefined();
	});

	it("rejects sizes smaller than the header", () => {
		const box = concatBytes([u32(4), fourCc("mdat"), new Uint8Array(8)]);
		expect(readBoxHeader(box, 0, box.length)).toBeUndefined();
	});
});

describe("splitChildBoxes", () => {
	it("splits a region into consecutive boxes", () => {
		const first = makeBox("ftyp", fourCc("isom"));
		const second = makeBox("free");
		const children = splitChildBoxes(concatBytes([first, second]), 0);
		expect(children?.map((child) => child.type)).toEqual(["ftyp", "free"]);
		expect(children?.[1].start).toBe(first.length);
	});

	it("returns undefined when a child is malformed", () => {
		const bytes = concatBytes([makeBox("free"), new Uint8Array([0, 0])]);
		expect(splitChildBoxes(bytes, 0)).toBeUndefined();
	});
});

describe("peekBox / readBoxBytes", () => {
	it("reads box headers and payloads from a Blob", async () => {
		const first = makeBox("ftyp", fourCc("isom"));
		const second = makeBox("mdat", new Uint8Array([9, 9]));
		const source = new Blob([concatBytes([first, second])]);

		const firstRef = await peekBox(source, 0);
		expect(firstRef).toEqual({
			type: "ftyp",
			start: 0,
			headerSize: 8,
			size: 12,
		});
		if (!firstRef) {
			return;
		}
		const secondRef = await peekBox(source, firstRef.size);
		expect(secondRef?.type).toBe("mdat");
		expect(Array.from(await readBoxBytes(source, firstRef))).toEqual(
			Array.from(first),
		);
	});

	it("returns undefined at end of input and for truncated boxes", async () => {
		const source = new Blob([makeBox("free")]);
		expect(await peekBox(source, source.size)).toBeUndefined();
		const truncated = new Blob([concatBytes([u32(100), fourCc("mdat")])]);
		expect(await peekBox(truncated, 0)).toBeUndefined();
	});
});
