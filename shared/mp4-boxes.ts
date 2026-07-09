/**
 * Minimal ISO BMFF (MP4) box framing helpers used to defragment
 * MediaRecorder output. Box semantics live in shared/mp4-defragment.ts.
 */

export type BoxRef = {
	/** Four-character box type, e.g. "moov". */
	type: string;
	/** Offset of the box header relative to the parsed region. */
	start: number;
	/** Header length in bytes: 8, or 16 for large-size boxes. */
	headerSize: number;
	/** Total box length including the header. */
	size: number;
};

export const BOX_HEADER_BYTES = 8;
export const LARGE_BOX_HEADER_BYTES = 16;
export const U32_MAX = 0xffffffff;

export function readU32(bytes: Uint8Array, offset: number): number {
	return new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	).getUint32(offset);
}

export function readI32(bytes: Uint8Array, offset: number): number {
	return new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	).getInt32(offset);
}

/** Returns the 64-bit value as a number, or undefined if it exceeds the safe integer range. */
export function readU64(bytes: Uint8Array, offset: number): number | undefined {
	const value = new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	).getBigUint64(offset);
	const asNumber = Number(value);
	return Number.isSafeInteger(asNumber) ? asNumber : undefined;
}

export function readFourCc(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(
		bytes[offset],
		bytes[offset + 1],
		bytes[offset + 2],
		bytes[offset + 3],
	);
}

export function u32(value: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value);
	return bytes;
}

export function i32(value: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setInt32(0, value);
	return bytes;
}

export function u64(value: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8);
	new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
	return bytes;
}

export function fourCc(type: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(4);
	for (let index = 0; index < 4; index += 1) {
		bytes[index] = type.charCodeAt(index);
	}
	return bytes;
}

/**
 * Packs u32 values into one buffer. Large sample tables must go through
 * these packers: spreading per-value byte arrays as call arguments hits the
 * engine's argument-count limit at roughly 100k values.
 */
export function u32Array(values: readonly number[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(values.length * 4);
	const view = new DataView(bytes.buffer);
	for (const [index, value] of values.entries()) {
		view.setUint32(index * 4, value);
	}
	return bytes;
}

/** Packs i32 values into one buffer. See u32Array for why packing is required. */
export function i32Array(values: readonly number[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(values.length * 4);
	const view = new DataView(bytes.buffer);
	for (const [index, value] of values.entries()) {
		view.setInt32(index * 4, value);
	}
	return bytes;
}

/** Packs u64 values into one buffer. See u32Array for why packing is required. */
export function u64Array(values: readonly number[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(values.length * 8);
	const view = new DataView(bytes.buffer);
	for (const [index, value] of values.entries()) {
		view.setBigUint64(index * 8, BigInt(value));
	}
	return bytes;
}

export function concatBytes(
	parts: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
	let total = 0;
	for (const part of parts) {
		total += part.length;
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

/** Wraps the payloads with a box header, using the large-size form only when required. */
export function makeBox(
	type: string,
	...payloads: Uint8Array[]
): Uint8Array<ArrayBuffer> {
	let payloadLength = 0;
	for (const payload of payloads) {
		payloadLength += payload.length;
	}
	if (payloadLength + BOX_HEADER_BYTES <= U32_MAX) {
		return concatBytes([
			u32(payloadLength + BOX_HEADER_BYTES),
			fourCc(type),
			...payloads,
		]);
	}
	return concatBytes([
		u32(1),
		fourCc(type),
		u64(payloadLength + LARGE_BOX_HEADER_BYTES),
		...payloads,
	]);
}

/** Wraps the payloads with a full box header (version + 24-bit flags). */
export function makeFullBox(
	type: string,
	version: number,
	flags: number,
	...payloads: Uint8Array[]
): Uint8Array<ArrayBuffer> {
	return makeBox(type, u32((version << 24) | flags), ...payloads);
}

/**
 * Decodes the size/type fields of a box header, without checking that the
 * declared size fits its container. `limit` bounds the readable header bytes.
 * Size-0 ("to end of file") boxes are rejected on purpose to keep the parser
 * strict.
 */
function parseRawBoxHeader(
	bytes: Uint8Array,
	offset: number,
	limit: number,
): Omit<BoxRef, "start"> | undefined {
	if (offset < 0 || offset + BOX_HEADER_BYTES > limit) {
		return undefined;
	}
	let size = readU32(bytes, offset);
	const type = readFourCc(bytes, offset + 4);
	let headerSize = BOX_HEADER_BYTES;
	if (size === 1) {
		if (offset + LARGE_BOX_HEADER_BYTES > limit) {
			return undefined;
		}
		const largeSize = readU64(bytes, offset + 8);
		if (largeSize === undefined) {
			return undefined;
		}
		size = largeSize;
		headerSize = LARGE_BOX_HEADER_BYTES;
	}
	return size < headerSize ? undefined : { type, headerSize, size };
}

/**
 * Parses a box header at `offset`. Returns undefined when the header does not
 * fit, the declared size is smaller than the header, or the box extends past
 * `end`.
 */
export function readBoxHeader(
	bytes: Uint8Array,
	offset: number,
	end: number,
): BoxRef | undefined {
	const raw = parseRawBoxHeader(bytes, offset, end);
	if (!raw || offset + raw.size > end) {
		return undefined;
	}
	return { ...raw, start: offset };
}

/**
 * Splits the region [start, end) of an in-memory buffer into consecutive
 * boxes. Returns undefined when any box is malformed or the boxes do not
 * exactly cover the region.
 */
export function splitChildBoxes(
	bytes: Uint8Array,
	start: number,
	end: number = bytes.length,
): BoxRef[] | undefined {
	const children: BoxRef[] = [];
	let offset = start;
	while (offset < end) {
		const child = readBoxHeader(bytes, offset, end);
		if (!child) {
			return undefined;
		}
		children.push(child);
		offset += child.size;
	}
	return children;
}

/**
 * Reads only a box header from a Blob without loading the payload.
 * Returns undefined at end of input or on a malformed header; callers can
 * tell clean EOF apart by checking `offset === source.size`.
 */
export async function peekBox(
	source: Blob,
	offset: number,
): Promise<BoxRef | undefined> {
	if (offset < 0 || offset + BOX_HEADER_BYTES > source.size) {
		return undefined;
	}
	const headEnd = Math.min(offset + LARGE_BOX_HEADER_BYTES, source.size);
	const head = new Uint8Array(
		await source.slice(offset, headEnd).arrayBuffer(),
	);
	const raw = parseRawBoxHeader(head, 0, head.length);
	if (!raw || offset + raw.size > source.size) {
		return undefined;
	}
	return { ...raw, start: offset };
}

/** Loads a whole box (header + payload) into memory. Never call this for mdat. */
export async function readBoxBytes(
	source: Blob,
	ref: BoxRef,
): Promise<Uint8Array> {
	return new Uint8Array(
		await source.slice(ref.start, ref.start + ref.size).arrayBuffer(),
	);
}
