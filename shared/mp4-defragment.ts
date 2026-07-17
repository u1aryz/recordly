/**
 * Rewrites a fragmented MP4 (MediaRecorder output: moov + moof/mdat pairs)
 * into a flat, faststart MP4 (ftyp + moov + single mdat). Fragmented files
 * have no usable duration or sample index in the moov, so players must scan
 * every fragment before playback can start — prohibitively slow over a
 * network. The rewrite is fail-closed: any unexpected structure or failed
 * consistency check bails out and leaves the original file untouched.
 */

import {
	type BoxRef,
	concatBytes,
	fourCc,
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
	U32_MAX,
	u32,
	u32Array,
	u64,
	u64Array,
} from "./mp4-boxes";

/** Upper bound for metadata boxes (ftyp/moov/moof) loaded into memory. */
const MAX_METADATA_BOX_BYTES = 64 * 1024 * 1024;

const TFHD_BASE_DATA_OFFSET = 0x000001;
const TFHD_SAMPLE_DESCRIPTION_INDEX = 0x000002;
const TFHD_DEFAULT_SAMPLE_DURATION = 0x000008;
const TFHD_DEFAULT_SAMPLE_SIZE = 0x000010;
const TFHD_DEFAULT_SAMPLE_FLAGS = 0x000020;
const TFHD_DURATION_IS_EMPTY = 0x010000;
const TFHD_DEFAULT_BASE_IS_MOOF = 0x020000;

const TRUN_DATA_OFFSET = 0x000001;
const TRUN_FIRST_SAMPLE_FLAGS = 0x000004;
const TRUN_SAMPLE_DURATION = 0x000100;
const TRUN_SAMPLE_SIZE = 0x000200;
const TRUN_SAMPLE_FLAGS = 0x000400;
const TRUN_SAMPLE_CTS = 0x000800;

const SAMPLE_FLAG_NON_SYNC = 0x00010000;

export type DefragmentBailReason =
	| "not_fragmented_mp4"
	| "no_samples"
	| "unsupported_box_layout"
	| "consistency_check_failed"
	| "read_error";

export type DefragmentPlan = {
	/** ftyp + rebuilt moov + mdat box header, ready to be written first. */
	header: Uint8Array<ArrayBuffer>;
	/** Sample data ranges in the source file, in output order. */
	mdatSourceRanges: { start: number; size: number }[];
};

export type PlanDefragmentResult =
	| { ok: true; plan: DefragmentPlan }
	| { ok: false; reason: DefragmentBailReason; detail?: string };

export type DefragmentPartOutcome =
	| { ok: true }
	| {
			ok: false;
			reason: string;
			/**
			 * True when the failure came from the platform (I/O errors, failed
			 * memory allocations) rather than the file's structure, so retrying
			 * later — typically once recording has stopped and released its
			 * memory — can succeed.
			 */
			transient?: boolean;
	  };

type SampleEntry = {
	duration: number;
	size: number;
	isSync: boolean;
	ctsOffset: number;
};

type SourceChunk = {
	trackIndex: number;
	sourceStart: number;
	byteLength: number;
	sampleCount: number;
};

type ParsedTrack = {
	trackId: number;
	mediaTimescale: number;
	tkhd: Uint8Array;
	mdhd: Uint8Array;
	hdlr: Uint8Array;
	mediaHeader: Uint8Array;
	dinf: Uint8Array;
	stsd: Uint8Array;
	samples: SampleEntry[];
	/**
	 * Sum of collected sample durations, in media timescale. Equals the decode
	 * time the next fragment's tfdt is expected to declare.
	 */
	decodeTime: number;
};

type TrexDefaults = {
	sampleDuration: number;
	sampleSize: number;
	sampleFlags: number;
};

type ParsedMovie = {
	mvhd: Uint8Array;
	movieTimescale: number;
	tracks: ParsedTrack[];
	trackIndexById: Map<number, number>;
	trexById: Map<number, TrexDefaults>;
};

function bail(
	reason: DefragmentBailReason,
	detail?: string,
): { ok: false; reason: DefragmentBailReason; detail?: string } {
	return { ok: false, reason, detail };
}

function subBox(bytes: Uint8Array, ref: BoxRef): Uint8Array {
	return bytes.subarray(ref.start, ref.start + ref.size);
}

/** Splits a whole in-memory box into its immediate children. */
function childBoxes(box: Uint8Array): BoxRef[] | undefined {
	const header = readBoxHeader(box, 0, box.length);
	return header ? splitChildBoxes(box, header.headerSize) : undefined;
}

/** free/skip boxes are padding and are silently dropped wherever they appear. */
function isPaddingBox(type: string): boolean {
	return type === "free" || type === "skip";
}

type FullBoxHeader = {
	version: number;
	flags: number;
	bodyStart: number;
};

/** Reads a full box's version/flags. `bodyStart` points just past version+flags. */
function readFullBoxHeader(box: Uint8Array): FullBoxHeader | undefined {
	const header = readBoxHeader(box, 0, box.length);
	if (
		!header ||
		header.size !== box.length ||
		box.length < header.headerSize + 4
	) {
		return undefined;
	}
	const versionAndFlags = readU32(box, header.headerSize);
	return {
		version: versionAndFlags >>> 24,
		flags: versionAndFlags & 0xffffff,
		bodyStart: header.headerSize + 4,
	};
}

/**
 * Field layout shared by mvhd and mdhd:
 * creation + modification (4 or 8 bytes each), then timescale, then duration.
 */
function readTimescale(box: Uint8Array): number | undefined {
	const full = readFullBoxHeader(box);
	if (!full || (full.version !== 0 && full.version !== 1)) {
		return undefined;
	}
	const timescaleOffset = full.bodyStart + (full.version === 1 ? 16 : 8);
	if (timescaleOffset + 4 > box.length) {
		return undefined;
	}
	return readU32(box, timescaleOffset);
}

/** Returns a copy of an mvhd/mdhd box with its duration field replaced. */
function withHeaderDuration(
	box: Uint8Array,
	duration: number,
): Uint8Array | undefined {
	const full = readFullBoxHeader(box);
	if (!full || (full.version !== 0 && full.version !== 1)) {
		return undefined;
	}
	const durationOffset = full.bodyStart + (full.version === 1 ? 20 : 12);
	return writeDurationAt(box, durationOffset, full.version, duration);
}

function readTkhdTrackId(box: Uint8Array): number | undefined {
	const full = readFullBoxHeader(box);
	if (!full || (full.version !== 0 && full.version !== 1)) {
		return undefined;
	}
	const trackIdOffset = full.bodyStart + (full.version === 1 ? 16 : 8);
	if (trackIdOffset + 4 > box.length) {
		return undefined;
	}
	return readU32(box, trackIdOffset);
}

/** Returns a copy of a tkhd box with its duration field replaced. */
function withTkhdDuration(
	box: Uint8Array,
	duration: number,
): Uint8Array | undefined {
	const full = readFullBoxHeader(box);
	if (!full || (full.version !== 0 && full.version !== 1)) {
		return undefined;
	}
	// tkhd has track_ID + reserved (8 bytes) between modification and duration.
	const durationOffset = full.bodyStart + (full.version === 1 ? 24 : 16);
	return writeDurationAt(box, durationOffset, full.version, duration);
}

function writeDurationAt(
	box: Uint8Array,
	offset: number,
	version: number,
	duration: number,
): Uint8Array | undefined {
	const width = version === 1 ? 8 : 4;
	if (offset + width > box.length) {
		return undefined;
	}
	if (version === 0 && duration > U32_MAX) {
		return undefined;
	}
	const copy = box.slice();
	copy.set(version === 1 ? u64(duration) : u32(duration), offset);
	return copy;
}

/** Whether a sample-table template box (stts/stsc/stco/stsz) has zero entries. */
function isEmptySampleTable(box: Uint8Array, type: string): boolean {
	const full = readFullBoxHeader(box);
	if (!full) {
		return false;
	}
	// stsz stores default sample_size before sample_count.
	const countOffset = type === "stsz" ? full.bodyStart + 4 : full.bodyStart;
	if (countOffset + 4 > box.length) {
		return false;
	}
	return readU32(box, countOffset) === 0;
}

function parseTrak(trakBox: Uint8Array): ParsedTrack | undefined {
	const children = childBoxes(trakBox);
	if (!children) {
		return undefined;
	}
	let tkhd: Uint8Array | undefined;
	let mdiaBox: Uint8Array | undefined;
	for (const child of children) {
		if (child.type === "tkhd") {
			tkhd = subBox(trakBox, child);
		} else if (child.type === "mdia") {
			mdiaBox = subBox(trakBox, child);
		} else if (!isPaddingBox(child.type)) {
			return undefined;
		}
	}
	const mdiaChildren = mdiaBox && childBoxes(mdiaBox);
	if (!tkhd || !mdiaBox || !mdiaChildren) {
		return undefined;
	}
	let mdhd: Uint8Array | undefined;
	let hdlr: Uint8Array | undefined;
	let minfBox: Uint8Array | undefined;
	for (const child of mdiaChildren) {
		if (child.type === "mdhd") {
			mdhd = subBox(mdiaBox, child);
		} else if (child.type === "hdlr") {
			hdlr = subBox(mdiaBox, child);
		} else if (child.type === "minf") {
			minfBox = subBox(mdiaBox, child);
		} else if (!isPaddingBox(child.type)) {
			return undefined;
		}
	}
	const minfChildren = minfBox && childBoxes(minfBox);
	if (!mdhd || !hdlr || !minfBox || !minfChildren) {
		return undefined;
	}
	let mediaHeader: Uint8Array | undefined;
	let dinf: Uint8Array | undefined;
	let stblBox: Uint8Array | undefined;
	for (const child of minfChildren) {
		if (child.type === "vmhd" || child.type === "smhd") {
			mediaHeader = subBox(minfBox, child);
		} else if (child.type === "dinf") {
			dinf = subBox(minfBox, child);
		} else if (child.type === "stbl") {
			stblBox = subBox(minfBox, child);
		} else if (!isPaddingBox(child.type)) {
			return undefined;
		}
	}
	const stblChildren = stblBox && childBoxes(stblBox);
	if (!mediaHeader || !dinf || !stblBox || !stblChildren) {
		return undefined;
	}
	let stsd: Uint8Array | undefined;
	for (const child of stblChildren) {
		if (child.type === "stsd") {
			stsd = subBox(stblBox, child);
		} else if (
			child.type === "stts" ||
			child.type === "stsc" ||
			child.type === "stsz" ||
			child.type === "stco"
		) {
			// The fragmented moov must only carry empty sample-table templates;
			// non-empty tables would index samples this rewrite does not copy.
			if (!isEmptySampleTable(subBox(stblBox, child), child.type)) {
				return undefined;
			}
		} else if (!isPaddingBox(child.type)) {
			return undefined;
		}
	}
	if (!stsd) {
		return undefined;
	}
	const trackId = readTkhdTrackId(tkhd);
	const mediaTimescale = readTimescale(mdhd);
	if (
		trackId === undefined ||
		mediaTimescale === undefined ||
		mediaTimescale === 0
	) {
		return undefined;
	}
	return {
		trackId,
		mediaTimescale,
		tkhd,
		mdhd,
		hdlr,
		mediaHeader,
		dinf,
		stsd,
		samples: [],
		decodeTime: 0,
	};
}

function parseMvex(mvexBox: Uint8Array): Map<number, TrexDefaults> | undefined {
	const children = childBoxes(mvexBox);
	if (!children) {
		return undefined;
	}
	const trexById = new Map<number, TrexDefaults>();
	for (const child of children) {
		if (isPaddingBox(child.type) || child.type === "mehd") {
			continue;
		}
		if (child.type !== "trex" || child.size < child.headerSize + 24) {
			return undefined;
		}
		const body = child.start + child.headerSize;
		trexById.set(readU32(mvexBox, body + 4), {
			sampleDuration: readU32(mvexBox, body + 12),
			sampleSize: readU32(mvexBox, body + 16),
			sampleFlags: readU32(mvexBox, body + 20),
		});
	}
	return trexById;
}

function parseMoov(moovBox: Uint8Array): ParsedMovie | undefined {
	const children = childBoxes(moovBox);
	if (!children) {
		return undefined;
	}
	let mvhd: Uint8Array | undefined;
	const tracks: ParsedTrack[] = [];
	let trexById: Map<number, TrexDefaults> | undefined;
	for (const child of children) {
		if (child.type === "mvhd") {
			mvhd = subBox(moovBox, child);
		} else if (child.type === "trak") {
			const track = parseTrak(subBox(moovBox, child));
			if (!track) {
				return undefined;
			}
			tracks.push(track);
		} else if (child.type === "mvex") {
			trexById = parseMvex(subBox(moovBox, child));
			if (!trexById) {
				return undefined;
			}
		} else if (!isPaddingBox(child.type)) {
			return undefined;
		}
	}
	if (!mvhd) {
		return undefined;
	}
	const movieTimescale = readTimescale(mvhd);
	if (movieTimescale === undefined || movieTimescale === 0) {
		return undefined;
	}
	const trackIndexById = new Map<number, number>();
	for (const [index, track] of tracks.entries()) {
		if (trackIndexById.has(track.trackId)) {
			return undefined;
		}
		trackIndexById.set(track.trackId, index);
	}
	return {
		mvhd,
		movieTimescale,
		tracks,
		trackIndexById,
		trexById: trexById ?? new Map(),
	};
}

type ParsedTfhd = {
	trackId: number;
	baseDataOffset?: number;
	defaultSampleDuration?: number;
	defaultSampleSize?: number;
	defaultSampleFlags?: number;
	durationIsEmpty: boolean;
	defaultBaseIsMoof: boolean;
};

function parseTfhd(box: Uint8Array): ParsedTfhd | undefined {
	const full = readFullBoxHeader(box);
	if (!full) {
		return undefined;
	}
	let offset = full.bodyStart;
	if (offset + 4 > box.length) {
		return undefined;
	}
	const trackId = readU32(box, offset);
	offset += 4;
	const result: ParsedTfhd = {
		trackId,
		durationIsEmpty: (full.flags & TFHD_DURATION_IS_EMPTY) !== 0,
		defaultBaseIsMoof: (full.flags & TFHD_DEFAULT_BASE_IS_MOOF) !== 0,
	};
	if (full.flags & TFHD_BASE_DATA_OFFSET) {
		if (offset + 8 > box.length) {
			return undefined;
		}
		const baseDataOffset =
			readU32(box, offset) * 0x100000000 + readU32(box, offset + 4);
		if (!Number.isSafeInteger(baseDataOffset)) {
			return undefined;
		}
		result.baseDataOffset = baseDataOffset;
		offset += 8;
	}
	if (full.flags & TFHD_SAMPLE_DESCRIPTION_INDEX) {
		offset += 4;
	}
	if (full.flags & TFHD_DEFAULT_SAMPLE_DURATION) {
		if (offset + 4 > box.length) {
			return undefined;
		}
		result.defaultSampleDuration = readU32(box, offset);
		offset += 4;
	}
	if (full.flags & TFHD_DEFAULT_SAMPLE_SIZE) {
		if (offset + 4 > box.length) {
			return undefined;
		}
		result.defaultSampleSize = readU32(box, offset);
		offset += 4;
	}
	if (full.flags & TFHD_DEFAULT_SAMPLE_FLAGS) {
		if (offset + 4 > box.length) {
			return undefined;
		}
		result.defaultSampleFlags = readU32(box, offset);
		offset += 4;
	}
	return offset <= box.length ? result : undefined;
}

/** Reads a tfdt box's baseMediaDecodeTime (u32 in version 0, u64 in version 1). */
function parseTfdt(box: Uint8Array): number | undefined {
	const full = readFullBoxHeader(box);
	if (!full || (full.version !== 0 && full.version !== 1)) {
		return undefined;
	}
	if (full.version === 0) {
		return full.bodyStart + 4 <= box.length
			? readU32(box, full.bodyStart)
			: undefined;
	}
	return full.bodyStart + 8 <= box.length
		? readU64(box, full.bodyStart)
		: undefined;
}

type ParsedTrun = {
	dataOffset: number;
	samples: SampleEntry[];
};

function parseTrun(
	box: Uint8Array,
	tfhd: ParsedTfhd,
	trex: TrexDefaults | undefined,
): ParsedTrun | undefined {
	const full = readFullBoxHeader(box);
	if (!full || (full.version !== 0 && full.version !== 1)) {
		return undefined;
	}
	// A run without an explicit data offset would depend on the previous
	// run's end position; MediaRecorder always writes one, so require it.
	if (!(full.flags & TRUN_DATA_OFFSET)) {
		return undefined;
	}
	let offset = full.bodyStart;
	if (offset + 8 > box.length) {
		return undefined;
	}
	const sampleCount = readU32(box, offset);
	offset += 4;
	const dataOffset = readI32(box, offset);
	offset += 4;
	let firstSampleFlags: number | undefined;
	if (full.flags & TRUN_FIRST_SAMPLE_FLAGS) {
		if (offset + 4 > box.length) {
			return undefined;
		}
		firstSampleFlags = readU32(box, offset);
		offset += 4;
	}
	const hasDuration = (full.flags & TRUN_SAMPLE_DURATION) !== 0;
	const hasSize = (full.flags & TRUN_SAMPLE_SIZE) !== 0;
	const hasFlags = (full.flags & TRUN_SAMPLE_FLAGS) !== 0;
	const hasCts = (full.flags & TRUN_SAMPLE_CTS) !== 0;
	const entryBytes =
		4 *
		((hasDuration ? 1 : 0) +
			(hasSize ? 1 : 0) +
			(hasFlags ? 1 : 0) +
			(hasCts ? 1 : 0));
	if (offset + sampleCount * entryBytes > box.length) {
		return undefined;
	}
	const samples: SampleEntry[] = [];
	for (let index = 0; index < sampleCount; index += 1) {
		let duration: number | undefined;
		let size: number | undefined;
		let flags: number | undefined;
		let ctsOffset = 0;
		if (hasDuration) {
			duration = readU32(box, offset);
			offset += 4;
		}
		if (hasSize) {
			size = readU32(box, offset);
			offset += 4;
		}
		if (hasFlags) {
			flags = readU32(box, offset);
			offset += 4;
		}
		if (hasCts) {
			ctsOffset =
				full.version === 0 ? readU32(box, offset) : readI32(box, offset);
			offset += 4;
		}
		duration = duration ?? tfhd.defaultSampleDuration ?? trex?.sampleDuration;
		size = size ?? tfhd.defaultSampleSize ?? trex?.sampleSize;
		flags =
			flags ??
			(index === 0 ? firstSampleFlags : undefined) ??
			tfhd.defaultSampleFlags ??
			trex?.sampleFlags;
		if (duration === undefined || size === undefined || flags === undefined) {
			return undefined;
		}
		samples.push({
			duration,
			size,
			isSync: (flags & SAMPLE_FLAG_NON_SYNC) === 0,
			ctsOffset,
		});
	}
	return { dataOffset, samples };
}

/**
 * Aligns a track's collected samples with a fragment's tfdt decode time.
 * Chromium's muxer gives each fragment's last sample an *estimated* duration
 * (from the nominal frame rate) and lets the next fragment's tfdt correct the
 * accumulated error. Apply the same correction to the previous sample,
 * otherwise the rebuilt stts drifts against real time and audio/video
 * desynchronize over long captures. Returns a failure detail when the
 * declared decode time cannot be reconciled.
 */
function reconcileTrackDecodeTime(
	track: ParsedTrack,
	baseDecodeTime: number,
): string | undefined {
	if (track.samples.length === 0) {
		if (baseDecodeTime !== 0) {
			return `track ${track.trackId} first fragment starts at nonzero decode time ${baseDecodeTime}`;
		}
		return undefined;
	}
	if (baseDecodeTime === track.decodeTime) {
		return undefined;
	}
	const lastSample = track.samples[track.samples.length - 1];
	const adjustedDuration =
		lastSample.duration + (baseDecodeTime - track.decodeTime);
	if (adjustedDuration <= 0 || adjustedDuration > U32_MAX) {
		return `tfdt correction out of range for track ${track.trackId} (adjusted duration ${adjustedDuration})`;
	}
	lastSample.duration = adjustedDuration;
	track.decodeTime = baseDecodeTime;
	return undefined;
}

type CollectMoofResult =
	| { ok: true }
	| { ok: false; reason: DefragmentBailReason; detail: string };

/** Parses one moof and appends its sample runs to the movie's tracks. */
function collectMoofChunks(
	moofBox: Uint8Array,
	moofStart: number,
	movie: ParsedMovie,
	chunks: SourceChunk[],
): CollectMoofResult {
	const layoutBail: CollectMoofResult = {
		ok: false,
		reason: "unsupported_box_layout",
		detail: `unrecognized moof at offset ${moofStart}`,
	};
	const children = childBoxes(moofBox);
	if (!children) {
		return layoutBail;
	}
	for (const child of children) {
		if (child.type === "mfhd" || isPaddingBox(child.type)) {
			continue;
		}
		if (child.type !== "traf") {
			return layoutBail;
		}
		const trafBox = subBox(moofBox, child);
		const trafChildren = splitChildBoxes(trafBox, child.headerSize);
		if (!trafChildren) {
			return layoutBail;
		}
		let tfhd: ParsedTfhd | undefined;
		let tfdtBox: Uint8Array | undefined;
		const truns: Uint8Array[] = [];
		for (const trafChild of trafChildren) {
			if (isPaddingBox(trafChild.type)) {
				continue;
			}
			if (trafChild.type === "tfdt") {
				if (tfdtBox) {
					return layoutBail;
				}
				tfdtBox = subBox(trafBox, trafChild);
			} else if (trafChild.type === "tfhd") {
				tfhd = parseTfhd(subBox(trafBox, trafChild));
				if (!tfhd) {
					return layoutBail;
				}
			} else if (trafChild.type === "trun") {
				truns.push(subBox(trafBox, trafChild));
			} else {
				return layoutBail;
			}
		}
		if (!tfhd) {
			return layoutBail;
		}
		if (tfhd.durationIsEmpty && truns.length > 0) {
			return layoutBail;
		}
		if (truns.length === 0) {
			continue;
		}
		const trackIndex = movie.trackIndexById.get(tfhd.trackId);
		if (trackIndex === undefined) {
			return layoutBail;
		}
		const base = tfhd.defaultBaseIsMoof ? moofStart : tfhd.baseDataOffset;
		if (base === undefined) {
			return layoutBail;
		}
		const track = movie.tracks[trackIndex];
		const trex = movie.trexById.get(tfhd.trackId);
		const runs: ParsedTrun[] = [];
		let sampleCount = 0;
		for (const trunBox of truns) {
			const trun = parseTrun(trunBox, tfhd, trex);
			if (!trun) {
				return layoutBail;
			}
			runs.push(trun);
			sampleCount += trun.samples.length;
		}
		// Chromium's muxer closes out a track with no pending samples by writing
		// an empty traf (a zero-sample trun plus a tfdt of 0) in the final moof.
		// It carries no sample data, so skip it without reconciling its tfdt —
		// the reset decode time would otherwise read as a huge backwards jump.
		if (sampleCount === 0) {
			continue;
		}
		if (tfdtBox) {
			const baseDecodeTime = parseTfdt(tfdtBox);
			if (baseDecodeTime === undefined) {
				return layoutBail;
			}
			const failureDetail = reconcileTrackDecodeTime(track, baseDecodeTime);
			if (failureDetail) {
				return {
					ok: false,
					reason: "consistency_check_failed",
					detail: failureDetail,
				};
			}
		}
		for (const trun of runs) {
			if (trun.samples.length === 0) {
				continue;
			}
			let byteLength = 0;
			for (const sample of trun.samples) {
				byteLength += sample.size;
			}
			chunks.push({
				trackIndex,
				sourceStart: base + trun.dataOffset,
				byteLength,
				sampleCount: trun.samples.length,
			});
			// push(...samples) would hit the argument limit for very large runs.
			for (const sample of trun.samples) {
				track.samples.push(sample);
				track.decodeTime += sample.duration;
			}
		}
	}
	return { ok: true };
}

function encodeRuns(values: number[]): { count: number; value: number }[] {
	const runs: { count: number; value: number }[] = [];
	for (const value of values) {
		const last = runs[runs.length - 1];
		if (last && last.value === value) {
			last.count += 1;
		} else {
			runs.push({ count: 1, value });
		}
	}
	return runs;
}

function buildSampleTables(
	track: ParsedTrack,
	trackChunks: SourceChunk[],
	chunkOffsets: number[],
	useCo64: boolean,
): Uint8Array {
	// Split-sized parts carry hundreds of thousands of samples, so every
	// table below must use the u32Array-style packers, never argument spreads.
	const parts: Uint8Array[] = [track.stsd];

	const sttsRuns = encodeRuns(track.samples.map((sample) => sample.duration));
	parts.push(
		makeFullBox(
			"stts",
			0,
			0,
			u32(sttsRuns.length),
			u32Array(sttsRuns.flatMap((run) => [run.count, run.value])),
		),
	);

	if (track.samples.some((sample) => sample.ctsOffset !== 0)) {
		const cttsRuns = encodeRuns(
			track.samples.map((sample) => sample.ctsOffset),
		);
		parts.push(
			makeFullBox(
				"ctts",
				1,
				0,
				u32(cttsRuns.length),
				// Interleaved (count, offset) pairs. Counts stay far below 2^31,
				// so the signed packer writes identical bytes for both fields.
				i32Array(cttsRuns.flatMap((run) => [run.count, run.value])),
			),
		);
	}

	if (track.samples.some((sample) => !sample.isSync)) {
		const syncSampleNumbers: number[] = [];
		for (const [index, sample] of track.samples.entries()) {
			if (sample.isSync) {
				syncSampleNumbers.push(index + 1);
			}
		}
		parts.push(
			makeFullBox(
				"stss",
				0,
				0,
				u32(syncSampleNumbers.length),
				u32Array(syncSampleNumbers),
			),
		);
	}

	const stscEntries: { firstChunk: number; samplesPerChunk: number }[] = [];
	for (const [index, chunk] of trackChunks.entries()) {
		const last = stscEntries[stscEntries.length - 1];
		if (!last || last.samplesPerChunk !== chunk.sampleCount) {
			stscEntries.push({
				firstChunk: index + 1,
				samplesPerChunk: chunk.sampleCount,
			});
		}
	}
	parts.push(
		makeFullBox(
			"stsc",
			0,
			0,
			u32(stscEntries.length),
			u32Array(
				stscEntries.flatMap((entry) => [
					entry.firstChunk,
					entry.samplesPerChunk,
					1,
				]),
			),
		),
	);

	parts.push(
		makeFullBox(
			"stsz",
			0,
			0,
			u32(0),
			u32(track.samples.length),
			u32Array(track.samples.map((sample) => sample.size)),
		),
	);

	if (useCo64) {
		parts.push(
			makeFullBox(
				"co64",
				0,
				0,
				u32(chunkOffsets.length),
				u64Array(chunkOffsets),
			),
		);
	} else {
		parts.push(
			makeFullBox(
				"stco",
				0,
				0,
				u32(chunkOffsets.length),
				u32Array(chunkOffsets),
			),
		);
	}

	return makeBox("stbl", ...parts);
}

function buildMoov(
	movie: ParsedMovie,
	chunks: SourceChunk[],
	chunkOffsets: number[],
	useCo64: boolean,
): Uint8Array | undefined {
	const trackMediaDurations = movie.tracks.map((track) =>
		track.samples.reduce((total, sample) => total + sample.duration, 0),
	);
	const trackMovieDurations = movie.tracks.map((track, index) =>
		Math.round(
			(trackMediaDurations[index] * movie.movieTimescale) /
				track.mediaTimescale,
		),
	);
	const movieDuration = Math.max(...trackMovieDurations);

	const mvhd = withHeaderDuration(movie.mvhd, movieDuration);
	if (!mvhd) {
		return undefined;
	}
	const parts: Uint8Array[] = [mvhd];
	for (const [trackIndex, track] of movie.tracks.entries()) {
		const tkhd = withTkhdDuration(track.tkhd, trackMovieDurations[trackIndex]);
		const mdhd = withHeaderDuration(
			track.mdhd,
			trackMediaDurations[trackIndex],
		);
		if (!tkhd || !mdhd) {
			return undefined;
		}
		const trackChunks: SourceChunk[] = [];
		const trackChunkOffsets: number[] = [];
		for (const [chunkIndex, chunk] of chunks.entries()) {
			if (chunk.trackIndex === trackIndex) {
				trackChunks.push(chunk);
				trackChunkOffsets.push(chunkOffsets[chunkIndex]);
			}
		}
		const stbl = buildSampleTables(
			track,
			trackChunks,
			trackChunkOffsets,
			useCo64,
		);
		const minf = makeBox("minf", track.mediaHeader, track.dinf, stbl);
		const mdia = makeBox("mdia", mdhd, track.hdlr, minf);
		parts.push(makeBox("trak", tkhd, mdia));
	}
	return makeBox("moov", ...parts);
}

/** Recursively verifies that the built box tree parses back cleanly. */
function isValidBoxTree(
	bytes: Uint8Array,
	start: number,
	end: number,
): boolean {
	const containerTypes = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
	const children = splitChildBoxes(bytes, start, end);
	if (!children) {
		return false;
	}
	for (const child of children) {
		if (containerTypes.has(child.type)) {
			const bodyStart = child.start + child.headerSize;
			if (!isValidBoxTree(bytes, bodyStart, child.start + child.size)) {
				return false;
			}
		}
	}
	return true;
}

function makeMdatHeader(payloadLength: number): Uint8Array {
	if (payloadLength + 8 <= U32_MAX) {
		return concatBytes([u32(payloadLength + 8), fourCc("mdat")]);
	}
	return concatBytes([u32(1), fourCc("mdat"), u64(payloadLength + 16)]);
}

/** Reads the size an 8- or 16-byte mdat header declares, or undefined. */
function readMdatDeclaredSize(
	header: Uint8Array,
	start: number,
	length: number,
): number | undefined {
	if (length === 8) {
		return readU32(header, start);
	}
	if (length === 16) {
		return readU64(header, start + 8);
	}
	return undefined;
}

async function planDefragmentInner(
	source: Blob,
): Promise<PlanDefragmentResult> {
	let ftypBytes: Uint8Array | undefined;
	let movie: ParsedMovie | undefined;
	const chunks: SourceChunk[] = [];
	const mdatBodies: { start: number; end: number }[] = [];
	let moofCount = 0;

	let offset = 0;
	while (offset < source.size) {
		const box = await peekBox(source, offset);
		if (!box) {
			return bail(
				"unsupported_box_layout",
				`malformed box at offset ${offset}`,
			);
		}
		if (box.type === "ftyp" || box.type === "moov" || box.type === "moof") {
			if (box.size > MAX_METADATA_BOX_BYTES) {
				return bail(
					"unsupported_box_layout",
					`${box.type} too large (${box.size} bytes)`,
				);
			}
		}
		if (box.type === "ftyp") {
			if (ftypBytes) {
				return bail("unsupported_box_layout", "duplicate ftyp");
			}
			ftypBytes = await readBoxBytes(source, box);
		} else if (box.type === "moov") {
			if (movie) {
				return bail("unsupported_box_layout", "duplicate moov");
			}
			movie = parseMoov(await readBoxBytes(source, box));
			if (!movie) {
				return bail("unsupported_box_layout", "unrecognized moov structure");
			}
		} else if (box.type === "moof") {
			if (!movie) {
				return bail("unsupported_box_layout", "moof before moov");
			}
			const moofBytes = await readBoxBytes(source, box);
			const collected = collectMoofChunks(moofBytes, box.start, movie, chunks);
			if (!collected.ok) {
				return bail(collected.reason, collected.detail);
			}
			moofCount += 1;
		} else if (box.type === "mdat") {
			mdatBodies.push({
				start: box.start + box.headerSize,
				end: box.start + box.size,
			});
		} else if (!isPaddingBox(box.type) && box.type !== "mfra") {
			// mfra (fragment random-access index) is dropped on purpose: it only
			// points into the moof boxes this rewrite removes.
			return bail(
				"unsupported_box_layout",
				`unexpected top-level box "${box.type}"`,
			);
		}
		offset += box.size;
	}

	if (!ftypBytes || !movie) {
		return bail("unsupported_box_layout", "missing ftyp or moov");
	}
	// Re-bind to consts so the closures below see the narrowed types.
	const ftyp = ftypBytes;
	const parsedMovie = movie;
	if (moofCount === 0) {
		return bail("not_fragmented_mp4");
	}
	if (
		parsedMovie.tracks.length === 0 ||
		parsedMovie.tracks.some((track) => track.samples.length === 0)
	) {
		return bail("no_samples");
	}

	// Sample data must consist of ordered, non-overlapping runs that each sit
	// inside an mdat payload; anything else means we misread the fragments.
	let previousEnd = 0;
	for (const chunk of chunks) {
		if (chunk.byteLength <= 0 || chunk.sourceStart < previousEnd) {
			return bail(
				"consistency_check_failed",
				"sample runs overlap or are out of order",
			);
		}
		const chunkEnd = chunk.sourceStart + chunk.byteLength;
		const withinMdat = mdatBodies.some(
			(body) => chunk.sourceStart >= body.start && chunkEnd <= body.end,
		);
		if (!withinMdat) {
			return bail(
				"consistency_check_failed",
				"sample run outside mdat payload",
			);
		}
		previousEnd = chunkEnd;
	}

	const payloadLength = chunks.reduce(
		(total, chunk) => total + chunk.byteLength,
		0,
	);
	const zeroOffsets = chunks.map(() => 0);

	const computePlan = (
		useCo64: boolean,
	): { header: Uint8Array<ArrayBuffer>; maxOffset: number } | undefined => {
		const sizingMoov = buildMoov(parsedMovie, chunks, zeroOffsets, useCo64);
		if (!sizingMoov) {
			return undefined;
		}
		const mdatHeader = makeMdatHeader(payloadLength);
		const headerLength = ftyp.length + sizingMoov.length + mdatHeader.length;
		const chunkOffsets: number[] = [];
		let nextOffset = headerLength;
		for (const chunk of chunks) {
			chunkOffsets.push(nextOffset);
			nextOffset += chunk.byteLength;
		}
		const maxOffset =
			chunkOffsets.length > 0 ? chunkOffsets[chunkOffsets.length - 1] : 0;
		const moov = buildMoov(parsedMovie, chunks, chunkOffsets, useCo64);
		if (!moov || moov.length !== sizingMoov.length) {
			return undefined;
		}
		return { header: concatBytes([ftyp, moov, mdatHeader]), maxOffset };
	};

	let planned = computePlan(false);
	if (planned && planned.maxOffset > U32_MAX) {
		planned = computePlan(true);
	}
	if (!planned) {
		return bail("consistency_check_failed", "failed to build moov");
	}

	// The header ends with a bare mdat box header (its payload is streamed
	// separately), so validate ftyp + moov as complete boxes and the trailing
	// bytes as an mdat header covering exactly the sample payload.
	const rebuiltFtyp = readBoxHeader(planned.header, 0, planned.header.length);
	const rebuiltMoov = rebuiltFtyp
		? readBoxHeader(planned.header, rebuiltFtyp.size, planned.header.length)
		: undefined;
	const mdatHeaderStart = rebuiltMoov
		? rebuiltMoov.start + rebuiltMoov.size
		: 0;
	const mdatHeaderLength = planned.header.length - mdatHeaderStart;
	const mdatDeclaredSize = readMdatDeclaredSize(
		planned.header,
		mdatHeaderStart,
		mdatHeaderLength,
	);
	if (
		rebuiltFtyp?.type !== "ftyp" ||
		rebuiltMoov?.type !== "moov" ||
		readFourCc(planned.header, mdatHeaderStart + 4) !== "mdat" ||
		mdatDeclaredSize !== mdatHeaderLength + payloadLength ||
		!isValidBoxTree(
			planned.header,
			rebuiltMoov.start + rebuiltMoov.headerSize,
			rebuiltMoov.start + rebuiltMoov.size,
		)
	) {
		return bail("consistency_check_failed", "rebuilt header failed validation");
	}

	return {
		ok: true,
		plan: {
			header: planned.header,
			mdatSourceRanges: chunks.map((chunk) => ({
				start: chunk.sourceStart,
				size: chunk.byteLength,
			})),
		},
	};
}

/**
 * Analyzes a fragmented MP4 and produces a rewrite plan without reading any
 * sample data into memory. Returns { ok: false } instead of throwing so a
 * bail-out can never be mistaken for a fatal error.
 */
export async function planDefragment(
	source: Blob,
): Promise<PlanDefragmentResult> {
	try {
		return await planDefragmentInner(source);
	} catch (error) {
		// Safety net for unexpected platform errors (e.g. Blob read failures).
		return bail(
			"read_error",
			error instanceof Error ? error.message : String(error),
		);
	}
}

/**
 * Streams the planned file into `writable`: the rebuilt header first, then
 * each sample-data range as a Blob slice so the platform copies the bytes
 * without materializing them in JS memory.
 */
export async function writeDefragmentPlan(
	source: Blob,
	plan: DefragmentPlan,
	writable: Pick<FileSystemWritableFileStream, "write">,
): Promise<void> {
	await writable.write(plan.header);
	for (const range of plan.mdatSourceRanges) {
		await writable.write(source.slice(range.start, range.start + range.size));
	}
}

/**
 * Defragments a just-saved part file in place. Writes go to the File System
 * Access API's swap file and only replace the original on a successful
 * close(), so any failure (including a crash mid-write) leaves the original
 * fragmented-but-playable file untouched.
 */
export async function defragmentPartFile(
	directory: FileSystemDirectoryHandle,
	fileName: string,
): Promise<DefragmentPartOutcome> {
	let fileHandle: FileSystemFileHandle;
	let source: File;
	try {
		fileHandle = await directory.getFileHandle(fileName);
		source = await fileHandle.getFile();
	} catch (error) {
		return {
			ok: false,
			reason: `failed to open part file: ${describeError(error)}`,
			transient: true,
		};
	}
	const planned = await planDefragment(source);
	if (!planned.ok) {
		return {
			ok: false,
			reason: planned.detail
				? `${planned.reason}: ${planned.detail}`
				: planned.reason,
			// Structural bails are deterministic; only platform read failures
			// (surfaced as read_error) can clear up on a later attempt.
			transient: planned.reason === "read_error",
		};
	}
	let writable: FileSystemWritableFileStream;
	try {
		writable = await fileHandle.createWritable({ keepExistingData: false });
	} catch (error) {
		return {
			ok: false,
			reason: `failed to open writable: ${describeError(error)}`,
			transient: true,
		};
	}
	try {
		await writeDefragmentPlan(source, planned.plan, writable);
		await writable.close();
	} catch (error) {
		await writable.abort().catch(() => undefined);
		return {
			ok: false,
			reason: `failed to rewrite part file: ${describeError(error)}`,
			transient: true,
		};
	}
	return { ok: true };
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
