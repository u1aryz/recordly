import { describe, expect, it, vi } from "vitest";
import {
	type BoxRef,
	concatBytes,
	fourCc,
	i32,
	makeBox,
	makeFullBox,
	readU32,
	readU64,
	splitChildBoxes,
	u32,
	u32Array,
	u64,
} from "@/shared/mp4-boxes";
import {
	type DefragmentPlan,
	defragmentPartFile,
	planDefragment,
	writeDefragmentPlan,
} from "@/shared/mp4-defragment";

const MOVIE_TIMESCALE = 1000;
const SYNC_SAMPLE_FLAGS = 0x02000000;
const NON_SYNC_SAMPLE_FLAGS = 0x01010000;

type TrackSpec = {
	trackId: number;
	timescale: number;
	kind: "video" | "audio";
	defaultSampleFlags: number;
};

type RunSpec = {
	trackId: number;
	samples: { duration: number; size: number }[];
	/** Emits trun first_sample_flags marking the first sample as sync. */
	firstSampleSync?: boolean;
	/**
	 * tfdt baseMediaDecodeTime override. Defaults to the sum of the track's
	 * earlier sample durations, matching Chromium's muxer for gapless output.
	 */
	decodeTime?: number;
	/** tfdt box version (u32 vs u64 payload). Defaults to 1. */
	tfdtVersion?: 0 | 1;
};

type FragmentSpec = {
	runs: RunSpec[];
};

function zeros(length: number): Uint8Array {
	return new Uint8Array(length);
}

/** Deterministic per-run payload so byte identity can be asserted after the rewrite. */
function runPayload(seed: number, length: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(length);
	for (let index = 0; index < length; index += 1) {
		bytes[index] = (seed * 31 + index) % 256;
	}
	return bytes;
}

function buildTrak(track: TrackSpec, sttsOverride?: Uint8Array): Uint8Array {
	const tkhd = makeFullBox(
		"tkhd",
		0,
		3,
		u32(0), // creation
		u32(0), // modification
		u32(track.trackId),
		u32(0), // reserved
		u32(0), // duration (unknown while fragmented)
		zeros(60),
	);
	const mdhd = makeFullBox(
		"mdhd",
		0,
		0,
		u32(0), // creation
		u32(0), // modification
		u32(track.timescale),
		u32(0), // duration (unknown while fragmented)
		u32(0), // language + pre_defined
	);
	const hdlr = makeFullBox(
		"hdlr",
		0,
		0,
		u32(0),
		fourCc(track.kind === "video" ? "vide" : "soun"),
		zeros(13),
	);
	const mediaHeader =
		track.kind === "video"
			? makeFullBox("vmhd", 0, 1, zeros(8))
			: makeFullBox("smhd", 0, 0, zeros(4));
	const dinf = makeBox(
		"dinf",
		makeFullBox("dref", 0, 0, u32(1), makeFullBox("url ", 0, 1)),
	);
	const sampleEntry = makeBox(
		track.kind === "video" ? "avc1" : "mp4a",
		zeros(20),
	);
	const stbl = makeBox(
		"stbl",
		makeFullBox("stsd", 0, 0, u32(1), sampleEntry),
		sttsOverride ?? makeFullBox("stts", 0, 0, u32(0)),
		makeFullBox("stsc", 0, 0, u32(0)),
		makeFullBox("stsz", 0, 0, u32(0), u32(0)),
		makeFullBox("stco", 0, 0, u32(0)),
	);
	const minf = makeBox("minf", mediaHeader, dinf, stbl);
	const mdia = makeBox("mdia", mdhd, hdlr, minf);
	return makeBox("trak", tkhd, mdia);
}

function buildMoov(tracks: TrackSpec[], sttsOverride?: Uint8Array): Uint8Array {
	const mvhd = makeFullBox(
		"mvhd",
		0,
		0,
		u32(0), // creation
		u32(0), // modification
		u32(MOVIE_TIMESCALE),
		u32(0), // duration (unknown while fragmented)
		zeros(80),
	);
	const trexes = tracks.map((track) =>
		makeFullBox(
			"trex",
			0,
			0,
			u32(track.trackId),
			u32(1),
			u32(0),
			u32(0),
			u32(0),
		),
	);
	return makeBox(
		"moov",
		mvhd,
		...tracks.map((track) => buildTrak(track, sttsOverride)),
		makeBox("mvex", ...trexes),
	);
}

function buildFragment(
	tracks: TrackSpec[],
	fragment: FragmentSpec,
	sequenceNumber: number,
	trackDecodeTimes: Map<number, number> = new Map(),
): { bytes: Uint8Array<ArrayBuffer>; payloads: Uint8Array<ArrayBuffer>[] } {
	const mfhd = makeFullBox("mfhd", 0, 0, u32(sequenceNumber));
	const payloads = fragment.runs.map((run, runIndex) =>
		runPayload(
			sequenceNumber * 10 + runIndex,
			run.samples.reduce((total, sample) => total + sample.size, 0),
		),
	);
	const buildTrafs = (dataOffsets: number[]) =>
		fragment.runs.map((run, runIndex) => {
			const track = tracks.find(
				(candidate) => candidate.trackId === run.trackId,
			);
			if (!track) {
				throw new Error(`unknown track ${run.trackId}`);
			}
			const tfhd = makeFullBox(
				"tfhd",
				0,
				0x020020, // default-base-is-moof + default_sample_flags
				u32(run.trackId),
				u32(track.defaultSampleFlags),
			);
			const decodeTime =
				run.decodeTime ?? trackDecodeTimes.get(run.trackId) ?? 0;
			const tfdt =
				run.tfdtVersion === 0
					? makeFullBox("tfdt", 0, 0, u32(decodeTime))
					: makeFullBox("tfdt", 1, 0, u64(decodeTime));
			const trunFlags = 0x000301 | (run.firstSampleSync ? 0x000004 : 0);
			const trun = makeFullBox(
				"trun",
				1,
				trunFlags,
				u32(run.samples.length),
				i32(dataOffsets[runIndex]),
				...(run.firstSampleSync ? [u32(SYNC_SAMPLE_FLAGS)] : []),
				// Packed rather than spread so the builder can produce runs with
				// hundreds of thousands of samples.
				u32Array(
					run.samples.flatMap((sample) => [sample.duration, sample.size]),
				),
			);
			return makeBox("traf", tfhd, tfdt, trun);
		});
	// Data offsets are moof-relative and depend on the moof size, so build
	// once for sizing and again with the real offsets.
	const sizingMoof = makeBox(
		"moof",
		mfhd,
		...buildTrafs(fragment.runs.map(() => 0)),
	);
	const dataOffsets: number[] = [];
	let cursor = sizingMoof.length + 8;
	for (const payload of payloads) {
		dataOffsets.push(cursor);
		cursor += payload.length;
	}
	const moof = makeBox("moof", mfhd, ...buildTrafs(dataOffsets));
	const mdat = makeBox("mdat", ...payloads);
	return { bytes: concatBytes([moof, mdat]), payloads };
}

function buildFtyp(): Uint8Array {
	return makeBox(
		"ftyp",
		fourCc("isom"),
		u32(0x200),
		fourCc("isom"),
		fourCc("iso6"),
	);
}

function buildFragmentedMp4(
	tracks: TrackSpec[],
	fragments: FragmentSpec[],
): { bytes: Uint8Array<ArrayBuffer>; runPayloads: Uint8Array<ArrayBuffer>[] } {
	const parts = [buildFtyp(), buildMoov(tracks)];
	const runPayloads: Uint8Array<ArrayBuffer>[] = [];
	const trackDecodeTimes = new Map<number, number>();
	for (const [index, fragment] of fragments.entries()) {
		const built = buildFragment(tracks, fragment, index + 1, trackDecodeTimes);
		parts.push(built.bytes);
		runPayloads.push(...built.payloads);
		for (const run of fragment.runs) {
			const durationTotal = run.samples.reduce(
				(total, sample) => total + sample.duration,
				0,
			);
			const runStart = run.decodeTime ?? trackDecodeTimes.get(run.trackId) ?? 0;
			trackDecodeTimes.set(run.trackId, runStart + durationTotal);
		}
	}
	return { bytes: concatBytes(parts), runPayloads };
}

async function assembleOutput(
	source: Blob,
	plan: DefragmentPlan,
): Promise<Uint8Array> {
	const written: Uint8Array[] = [];
	await writeDefragmentPlan(source, plan, {
		write: (async (chunk: Blob | Uint8Array) => {
			written.push(
				chunk instanceof Uint8Array
					? chunk
					: new Uint8Array(await chunk.arrayBuffer()),
			);
		}) as FileSystemWritableFileStream["write"],
	});
	return concatBytes(written);
}

type BoxIndex = Map<string, { ref: BoxRef; bytes: Uint8Array }>;

function indexChildren(
	bytes: Uint8Array,
	start: number,
	end: number,
): BoxIndex {
	const children = splitChildBoxes(bytes, start, end);
	if (!children) {
		throw new Error("malformed box tree");
	}
	const index: BoxIndex = new Map();
	for (const child of children) {
		index.set(child.type, {
			ref: child,
			bytes: bytes.subarray(child.start, child.start + child.size),
		});
	}
	return index;
}

function childrenOf(entry: { ref: BoxRef; bytes: Uint8Array }): BoxIndex {
	return indexChildren(entry.bytes, entry.ref.headerSize, entry.bytes.length);
}

/** Descends moov > trak(nth) > mdia and returns { mdhd, stbl children }. */
function trackTablesOf(
	moovEntry: { ref: BoxRef; bytes: Uint8Array },
	trackIndex: number,
): { mdhd: Uint8Array; tables: BoxIndex } {
	const traks = splitChildBoxes(
		moovEntry.bytes,
		moovEntry.ref.headerSize,
	)?.filter((box) => box.type === "trak");
	const trak = traks?.[trackIndex];
	if (!trak) {
		throw new Error(`trak ${trackIndex} missing`);
	}
	const trakEntry = {
		ref: trak,
		bytes: moovEntry.bytes.subarray(trak.start, trak.start + trak.size),
	};
	const mdia = childrenOf(trakEntry).get("mdia");
	const mdhd = mdia && childrenOf(mdia).get("mdhd");
	const minf = mdia && childrenOf(mdia).get("minf");
	const stbl = minf && childrenOf(minf).get("stbl");
	if (!mdhd || !stbl) {
		throw new Error("mdhd or stbl missing");
	}
	return { mdhd: mdhd.bytes, tables: childrenOf(stbl) };
}

/** Reads full-box table entries laid out as fixed-width u32 tuples after the entry count. */
function readTableEntries(
	box: Uint8Array | undefined,
	valuesPerEntry: number,
): number[][] {
	if (!box) {
		throw new Error("table box missing");
	}
	const entryCount = readU32(box, 12);
	const entries: number[][] = [];
	for (let index = 0; index < entryCount; index += 1) {
		const entry: number[] = [];
		for (let value = 0; value < valuesPerEntry; value += 1) {
			entry.push(readU32(box, 16 + (index * valuesPerEntry + value) * 4));
		}
		entries.push(entry);
	}
	return entries;
}

/** stsz has a default-size field before the count, unlike the other tables. */
function readStszSizes(box: Uint8Array | undefined): number[] {
	if (!box) {
		throw new Error("stsz missing");
	}
	const sampleCount = readU32(box, 16);
	const sizes: number[] = [];
	for (let index = 0; index < sampleCount; index += 1) {
		sizes.push(readU32(box, 20 + index * 4));
	}
	return sizes;
}

const VIDEO_TRACK: TrackSpec = {
	trackId: 2,
	timescale: 30000,
	kind: "video",
	defaultSampleFlags: NON_SYNC_SAMPLE_FLAGS,
};
const AUDIO_TRACK: TrackSpec = {
	trackId: 1,
	timescale: 44100,
	kind: "audio",
	defaultSampleFlags: SYNC_SAMPLE_FLAGS,
};

const TWO_TRACK_FRAGMENTS: FragmentSpec[] = [
	{
		runs: [
			{
				trackId: 1,
				samples: [
					{ duration: 1024, size: 100 },
					{ duration: 1024, size: 200 },
					{ duration: 1000, size: 300 },
				],
			},
			{
				trackId: 2,
				samples: [
					{ duration: 1500, size: 1000 },
					{ duration: 1501, size: 2000 },
				],
				firstSampleSync: true,
			},
		],
	},
	{
		runs: [
			{
				trackId: 1,
				samples: [
					{ duration: 1024, size: 150 },
					{ duration: 1024, size: 250 },
				],
			},
			{
				trackId: 2,
				samples: [
					{ duration: 1500, size: 3000 },
					{ duration: 1500, size: 500 },
					{ duration: 1500, size: 700 },
				],
				firstSampleSync: true,
			},
		],
	},
];

const AUDIO_ONLY_FRAGMENTS: FragmentSpec[] = [
	{
		runs: [
			{
				trackId: 1,
				samples: [
					{ duration: 1024, size: 40 },
					{ duration: 1024, size: 60 },
				],
			},
		],
	},
];

describe("planDefragment", () => {
	it("rewrites a fragmented file into a flat faststart MP4", async () => {
		const { bytes, runPayloads } = buildFragmentedMp4(
			[AUDIO_TRACK, VIDEO_TRACK],
			TWO_TRACK_FRAGMENTS,
		);
		const source = new Blob([bytes]);
		const planned = await planDefragment(source);
		expect(planned.ok).toBe(true);
		if (!planned.ok) {
			return;
		}
		const output = await assembleOutput(source, planned.plan);

		// Faststart layout with no fragment boxes left.
		const topLevel = splitChildBoxes(output, 0);
		expect(topLevel?.map((box) => box.type)).toEqual(["ftyp", "moov", "mdat"]);

		const moovEntry = indexChildren(output, 0, output.length).get("moov");
		if (!moovEntry) {
			throw new Error("moov missing");
		}
		// mvex is gone and both traks survive.
		const moovChildren = splitChildBoxes(
			moovEntry.bytes,
			moovEntry.ref.headerSize,
		);
		expect(moovChildren?.map((box) => box.type)).toEqual([
			"mvhd",
			"trak",
			"trak",
		]);

		// mvhd duration becomes the longest track duration in movie timescale.
		const audioMediaDuration = 1024 + 1024 + 1000 + 1024 + 1024;
		const videoMediaDuration = 1500 + 1501 + 1500 + 1500 + 1500;
		const expectedMovieDuration = Math.max(
			Math.round(
				(audioMediaDuration * MOVIE_TIMESCALE) / AUDIO_TRACK.timescale,
			),
			Math.round(
				(videoMediaDuration * MOVIE_TIMESCALE) / VIDEO_TRACK.timescale,
			),
		);
		const mvhd = childrenOf(moovEntry).get("mvhd");
		expect(mvhd && readU32(mvhd.bytes, 24)).toBe(expectedMovieDuration);

		// Audio track: correct media duration, all samples sync (no stss).
		const audio = trackTablesOf(moovEntry, 0);
		expect(readU32(audio.mdhd, 24)).toBe(audioMediaDuration);
		expect(audio.tables.has("stss")).toBe(false);
		expect(readTableEntries(audio.tables.get("stts")?.bytes, 2)).toEqual([
			[2, 1024],
			[1, 1000],
			[2, 1024],
		]);
		expect(readStszSizes(audio.tables.get("stsz")?.bytes)).toEqual([
			100, 200, 300, 150, 250,
		]);
		expect(readTableEntries(audio.tables.get("stsc")?.bytes, 3)).toEqual([
			[1, 3, 1],
			[2, 2, 1],
		]);

		// Video track: only the first sample of each fragment is a sync sample.
		const video = trackTablesOf(moovEntry, 1);
		expect(readU32(video.mdhd, 24)).toBe(videoMediaDuration);
		expect(readTableEntries(video.tables.get("stss")?.bytes, 1).flat()).toEqual(
			[1, 3],
		);
		expect(video.tables.has("ctts")).toBe(false);

		// Sample bytes are copied verbatim; runs stay in source order a1,v1,a2,v2.
		const audioOffsets = readTableEntries(
			audio.tables.get("stco")?.bytes,
			1,
		).flat();
		const videoOffsets = readTableEntries(
			video.tables.get("stco")?.bytes,
			1,
		).flat();
		const orderedOffsets = [
			audioOffsets[0],
			videoOffsets[0],
			audioOffsets[1],
			videoOffsets[1],
		];
		for (const [index, payload] of runPayloads.entries()) {
			const offset = orderedOffsets[index];
			expect(
				Array.from(output.subarray(offset, offset + payload.length)),
			).toEqual(Array.from(payload));
		}

		// Output ends exactly where the mdat payload ends.
		const payloadTotal = runPayloads.reduce(
			(sum, payload) => sum + payload.length,
			0,
		);
		expect(output.length).toBe(planned.plan.header.length + payloadTotal);
	});

	it("handles a video-only stream", async () => {
		const fragments: FragmentSpec[] = [
			{
				runs: [
					{
						trackId: 2,
						samples: [
							{ duration: 1500, size: 400 },
							{ duration: 1500, size: 500 },
						],
						firstSampleSync: true,
					},
				],
			},
		];
		const { bytes } = buildFragmentedMp4([VIDEO_TRACK], fragments);
		const source = new Blob([bytes]);
		const planned = await planDefragment(source);
		expect(planned.ok).toBe(true);
		if (!planned.ok) {
			return;
		}
		const output = await assembleOutput(source, planned.plan);
		expect(splitChildBoxes(output, 0)?.map((box) => box.type)).toEqual([
			"ftyp",
			"moov",
			"mdat",
		]);
	});

	it("folds tfdt corrections into the previous fragment's last sample duration", async () => {
		// Chromium estimates each fragment's last sample duration from the
		// nominal frame rate; the next fragment's tfdt carries the real decode
		// time. The rewrite must apply that correction or the flat file drifts.
		const fragments: FragmentSpec[] = [
			{
				runs: [
					{
						trackId: 2,
						samples: [
							{ duration: 1500, size: 1000 },
							{ duration: 1500, size: 2000 },
						],
						firstSampleSync: true,
					},
				],
			},
			{
				runs: [
					{
						trackId: 2,
						samples: [
							{ duration: 1500, size: 3000 },
							{ duration: 1500, size: 500 },
						],
						// 100 ticks later than the declared durations (gap).
						decodeTime: 3100,
						firstSampleSync: true,
					},
				],
			},
			{
				runs: [
					{
						trackId: 2,
						samples: [{ duration: 1500, size: 700 }],
						// 50 ticks earlier than declared (estimate overshoot).
						decodeTime: 6050,
						firstSampleSync: true,
					},
				],
			},
		];
		const { bytes } = buildFragmentedMp4([VIDEO_TRACK], fragments);
		const planned = await planDefragment(new Blob([bytes]));
		expect(planned.ok).toBe(true);
		if (!planned.ok) {
			return;
		}
		const output = await assembleOutput(new Blob([bytes]), planned.plan);
		const moovEntry = indexChildren(output, 0, output.length).get("moov");
		if (!moovEntry) {
			throw new Error("moov missing");
		}
		const { mdhd, tables } = trackTablesOf(moovEntry, 0);
		// Fragment 1's last sample stretches by +100, fragment 2's shrinks by -50.
		expect(readTableEntries(tables.get("stts")?.bytes, 2)).toEqual([
			[1, 1500],
			[1, 1600],
			[1, 1500],
			[1, 1450],
			[1, 1500],
		]);
		expect(readU32(mdhd, 24)).toBe(1500 + 1600 + 1500 + 1450 + 1500);
	});

	it("applies a version 0 (u32) tfdt correction", async () => {
		const fragments: FragmentSpec[] = [
			{
				runs: [
					{
						trackId: 1,
						samples: [
							{ duration: 1024, size: 40 },
							{ duration: 1024, size: 60 },
						],
						tfdtVersion: 0,
					},
				],
			},
			{
				runs: [
					{
						trackId: 1,
						samples: [{ duration: 1024, size: 80 }],
						decodeTime: 2148,
						tfdtVersion: 0,
					},
				],
			},
		];
		const { bytes } = buildFragmentedMp4([AUDIO_TRACK], fragments);
		const planned = await planDefragment(new Blob([bytes]));
		expect(planned.ok).toBe(true);
		if (!planned.ok) {
			return;
		}
		const output = await assembleOutput(new Blob([bytes]), planned.plan);
		const moovEntry = indexChildren(output, 0, output.length).get("moov");
		if (!moovEntry) {
			throw new Error("moov missing");
		}
		const { tables } = trackTablesOf(moovEntry, 0);
		expect(readTableEntries(tables.get("stts")?.bytes, 2)).toEqual([
			[1, 1024],
			[1, 1124],
			[1, 1024],
		]);
	});

	it("skips an empty traf written when a track ends before the recording", async () => {
		// Chromium's muxer closes out a track with no pending samples by writing
		// a zero-sample trun plus a tfdt of 0 in the final moof. That reset
		// decode time must be ignored, not treated as a backwards tfdt jump.
		const fragments: FragmentSpec[] = [
			...TWO_TRACK_FRAGMENTS,
			{
				runs: [
					{ trackId: 1, samples: [], decodeTime: 0 },
					{
						trackId: 2,
						samples: [{ duration: 1500, size: 900 }],
						firstSampleSync: true,
					},
				],
			},
		];
		const { bytes } = buildFragmentedMp4([AUDIO_TRACK, VIDEO_TRACK], fragments);
		const source = new Blob([bytes]);
		const planned = await planDefragment(source);
		if (!planned.ok) {
			throw new Error(`bail: ${planned.reason} ${planned.detail ?? ""}`);
		}
		const output = await assembleOutput(source, planned.plan);
		const moovEntry = indexChildren(output, 0, output.length).get("moov");
		if (!moovEntry) {
			throw new Error("moov missing");
		}
		// The audio track keeps only the samples from the real fragments.
		const audio = trackTablesOf(moovEntry, 0);
		expect(readStszSizes(audio.tables.get("stsz")?.bytes)).toEqual([
			100, 200, 300, 150, 250,
		]);
		// The video samples of the final fragment survive the skipped traf.
		const video = trackTablesOf(moovEntry, 1);
		expect(readStszSizes(video.tables.get("stsz")?.bytes)).toEqual([
			1000, 2000, 3000, 500, 700, 900,
		]);
	});

	it("bails out when a tfdt correction would zero out a sample duration", async () => {
		const fragments: FragmentSpec[] = [
			{
				runs: [
					{
						trackId: 1,
						samples: [
							{ duration: 1024, size: 40 },
							{ duration: 1024, size: 60 },
						],
					},
				],
			},
			{
				runs: [
					{
						trackId: 1,
						samples: [{ duration: 1024, size: 80 }],
						// Rewinds a full sample duration: 2048 - 1024 leaves 0.
						decodeTime: 1024,
					},
				],
			},
		];
		const { bytes } = buildFragmentedMp4([AUDIO_TRACK], fragments);
		const planned = await planDefragment(new Blob([bytes]));
		expect(planned).toMatchObject({
			ok: false,
			reason: "consistency_check_failed",
		});
	});

	it("bails out when a track's first fragment starts at a nonzero decode time", async () => {
		const fragments: FragmentSpec[] = [
			{
				runs: [
					{
						trackId: 1,
						samples: [{ duration: 1024, size: 40 }],
						decodeTime: 10,
					},
				],
			},
		];
		const { bytes } = buildFragmentedMp4([AUDIO_TRACK], fragments);
		const planned = await planDefragment(new Blob([bytes]));
		expect(planned).toMatchObject({
			ok: false,
			reason: "consistency_check_failed",
		});
	});

	it("bails out on an already-flat MP4 without fragments", async () => {
		const flat = concatBytes([
			buildFtyp(),
			buildMoov([AUDIO_TRACK]),
			makeBox("mdat", new Uint8Array([1, 2, 3])),
		]);
		const planned = await planDefragment(new Blob([flat]));
		expect(planned).toMatchObject({ ok: false, reason: "not_fragmented_mp4" });
	});

	it("defragments a split-sized part with hundreds of thousands of samples", async () => {
		// A ~2GiB rollover part spans 45 minutes to 3+ hours of recording,
		// i.e. hundreds of thousands of samples per track. Regression test for
		// the argument-spread RangeError that made exactly those parts bail
		// out (spreading one 4-byte array per sample into makeFullBox).
		const fragmentCount = 2000;
		const samplesPerFragment = 200;
		const fragments: FragmentSpec[] = Array.from(
			{ length: fragmentCount },
			() => ({
				runs: [
					{
						trackId: 1,
						// Alternating durations defeat run-length encoding, so stts
						// grows with the sample count just like real 29.97fps video.
						samples: Array.from({ length: samplesPerFragment }, (_, index) => ({
							duration: index % 2 === 0 ? 1023 : 1024,
							size: 1,
						})),
					},
				],
			}),
		);
		const { bytes } = buildFragmentedMp4([AUDIO_TRACK], fragments);
		const planned = await planDefragment(new Blob([bytes]));
		if (!planned.ok) {
			throw new Error(`bail: ${planned.reason} ${planned.detail ?? ""}`);
		}
		expect(planned.plan.mdatSourceRanges).toHaveLength(fragmentCount);

		// Spot-check table sizes without materializing huge expected arrays.
		const sampleCount = fragmentCount * samplesPerFragment;
		const moovEntry = indexChildren(
			planned.plan.header,
			0,
			planned.plan.header.length - 8, // trailing 8-byte mdat header
		).get("moov");
		if (!moovEntry) {
			throw new Error("moov missing");
		}
		const { tables } = trackTablesOf(moovEntry, 0);
		const stsz = tables.get("stsz")?.bytes;
		expect(stsz && readU32(stsz, 16)).toBe(sampleCount);
		const stts = tables.get("stts")?.bytes;
		expect(stts && readU32(stts, 12)).toBe(sampleCount);
		expect(stts && readU32(stts, 16)).toBe(1); // first entry count
		expect(stts && readU32(stts, 20)).toBe(1023); // first entry duration
	});

	it("drops a trailing mfra index box", async () => {
		// Chromium's muxer appends mfra when a recording stops cleanly; it only
		// points into the removed moof boxes, so the rewrite discards it.
		const { bytes } = buildFragmentedMp4([AUDIO_TRACK], AUDIO_ONLY_FRAGMENTS);
		const mfra = makeBox("mfra", makeFullBox("mfro", 0, 0, u32(24)));
		const source = new Blob([concatBytes([bytes, mfra])]);
		const planned = await planDefragment(source);
		expect(planned.ok).toBe(true);
		if (!planned.ok) {
			return;
		}
		const output = await assembleOutput(source, planned.plan);
		expect(splitChildBoxes(output, 0)?.map((box) => box.type)).toEqual([
			"ftyp",
			"moov",
			"mdat",
		]);
	});

	it("bails out on an unexpected top-level box", async () => {
		const { bytes } = buildFragmentedMp4([AUDIO_TRACK], AUDIO_ONLY_FRAGMENTS);
		const withUnknown = concatBytes([
			bytes,
			makeBox("wide", new Uint8Array(4)),
		]);
		const planned = await planDefragment(new Blob([withUnknown]));
		expect(planned).toMatchObject({
			ok: false,
			reason: "unsupported_box_layout",
		});
	});

	it("bails out on truncated input", async () => {
		const { bytes } = buildFragmentedMp4(
			[AUDIO_TRACK, VIDEO_TRACK],
			TWO_TRACK_FRAGMENTS,
		);
		const planned = await planDefragment(
			new Blob([bytes.subarray(0, bytes.length - 10)]),
		);
		expect(planned).toMatchObject({
			ok: false,
			reason: "unsupported_box_layout",
		});
	});

	it("bails out when the moov carries a non-empty sample table", async () => {
		// A non-empty stts means the moov already indexes samples this rewrite
		// would not copy, so it must be rejected.
		const nonEmptyStts = makeFullBox("stts", 0, 0, u32(1), u32(1), u32(1024));
		const parts = [buildFtyp(), buildMoov([AUDIO_TRACK], nonEmptyStts)];
		const fragment = buildFragment([AUDIO_TRACK], AUDIO_ONLY_FRAGMENTS[0], 1);
		const bytes = concatBytes([...parts, fragment.bytes]);
		const planned = await planDefragment(new Blob([bytes]));
		expect(planned).toMatchObject({
			ok: false,
			reason: "unsupported_box_layout",
		});
	});

	it("switches to co64 chunk offsets when offsets exceed the 32-bit range", async () => {
		// Only box headers are ever read, so a sparse fake Blob can pretend to
		// hold >4GiB of sample data without allocating it. Three ~2.2GB
		// fragments push the third chunk offset past the u32 range.
		const sampleSize = 2_200_000_000;
		const fragmentCount = 3;
		const meta = concatBytes([buildFtyp(), buildMoov([AUDIO_TRACK])]);
		const buildHugeMoof = (
			sequenceNumber: number,
			dataOffset: number,
		): Uint8Array =>
			makeBox(
				"moof",
				makeFullBox("mfhd", 0, 0, u32(sequenceNumber)),
				makeBox(
					"traf",
					makeFullBox(
						"tfhd",
						0,
						0x020020,
						u32(AUDIO_TRACK.trackId),
						u32(AUDIO_TRACK.defaultSampleFlags),
					),
					makeFullBox(
						"trun",
						1,
						0x000301,
						u32(1),
						i32(dataOffset),
						u32(1024),
						u32(sampleSize),
					),
				),
			);
		const segments: { start: number; bytes: Uint8Array }[] = [
			{ start: 0, bytes: meta },
		];
		let position = meta.length;
		for (let index = 0; index < fragmentCount; index += 1) {
			const sizingMoof = buildHugeMoof(index + 1, 0);
			const moof = buildHugeMoof(index + 1, sizingMoof.length + 8);
			const mdatHeader = concatBytes([u32(sampleSize + 8), fourCc("mdat")]);
			segments.push({
				start: position,
				bytes: concatBytes([moof, mdatHeader]),
			});
			position += moof.length + mdatHeader.length + sampleSize;
		}
		const fakeSource = {
			size: position,
			// Serves metadata segments and zero-fills the virtual sample data
			// (which the planner never reads beyond box-header peeks).
			slice(start: number, end: number): Blob {
				const out = new Uint8Array(Math.max(0, end - start));
				for (const segment of segments) {
					const from = Math.max(start, segment.start);
					const to = Math.min(end, segment.start + segment.bytes.length);
					if (from < to) {
						out.set(
							segment.bytes.subarray(from - segment.start, to - segment.start),
							from - start,
						);
					}
				}
				return new Blob([out]);
			},
		} as Blob;

		const planned = await planDefragment(fakeSource);
		if (!planned.ok) {
			throw new Error(`bail: ${planned.reason} ${planned.detail ?? ""}`);
		}
		// The rebuilt header ends with a large-size mdat header (16 bytes)
		// because the combined payload exceeds the u32 range.
		const moovEntry = indexChildren(
			planned.plan.header,
			0,
			planned.plan.header.length - 16,
		).get("moov");
		if (!moovEntry) {
			throw new Error("moov missing");
		}
		const { tables } = trackTablesOf(moovEntry, 0);
		expect(tables.has("stco")).toBe(false);
		const co64 = tables.get("co64");
		if (!co64) {
			throw new Error("co64 missing");
		}
		expect(readU32(co64.bytes, 12)).toBe(fragmentCount);
		expect(readU64(co64.bytes, 16 + 16)).toBeGreaterThan(0xffffffff);
		expect(planned.plan.mdatSourceRanges).toHaveLength(fragmentCount);
	});
});

describe("defragmentPartFile", () => {
	function createFakeHandles(sourceBytes: Uint8Array<ArrayBuffer>) {
		const written: Uint8Array[] = [];
		let closed = false;
		let aborted = false;
		const writable = {
			write: vi.fn(async (chunk: Blob | Uint8Array) => {
				written.push(
					chunk instanceof Uint8Array
						? chunk
						: new Uint8Array(await (chunk as Blob).arrayBuffer()),
				);
			}),
			close: vi.fn(async () => {
				closed = true;
			}),
			abort: vi.fn(async () => {
				aborted = true;
			}),
		};
		const createWritable = vi.fn(async () => writable);
		const fileHandle = {
			getFile: vi.fn(async () => new Blob([sourceBytes])),
			createWritable,
		};
		const directory = {
			getFileHandle: vi.fn(async () => fileHandle),
		} as unknown as FileSystemDirectoryHandle;
		return {
			directory,
			createWritable,
			writable,
			written,
			isClosed: () => closed,
			isAborted: () => aborted,
		};
	}

	it("rewrites the file and closes the writable on success", async () => {
		const { bytes } = buildFragmentedMp4(
			[AUDIO_TRACK, VIDEO_TRACK],
			TWO_TRACK_FRAGMENTS,
		);
		const fake = createFakeHandles(bytes);
		const outcome = await defragmentPartFile(fake.directory, "part-001.mp4");
		expect(outcome).toEqual({ ok: true });
		expect(fake.isClosed()).toBe(true);
		expect(fake.isAborted()).toBe(false);
		const output = concatBytes(fake.written);
		expect(splitChildBoxes(output, 0)?.map((box) => box.type)).toEqual([
			"ftyp",
			"moov",
			"mdat",
		]);
	});

	it("reports monotonic byte progress up to the rewritten size", async () => {
		const { bytes } = buildFragmentedMp4(
			[AUDIO_TRACK, VIDEO_TRACK],
			TWO_TRACK_FRAGMENTS,
		);
		const fake = createFakeHandles(bytes);
		const progress: { written: number; total: number }[] = [];
		const outcome = await defragmentPartFile(
			fake.directory,
			"part-001.mp4",
			(written, total) => {
				progress.push({ written, total });
			},
		);
		expect(outcome).toEqual({ ok: true });
		const outputLength = concatBytes(fake.written).length;
		expect(progress.length).toBeGreaterThan(1);
		for (const [index, entry] of progress.entries()) {
			expect(entry.total).toBe(outputLength);
			if (index > 0) {
				expect(entry.written).toBeGreaterThanOrEqual(
					progress[index - 1].written,
				);
			}
		}
		expect(progress[progress.length - 1].written).toBe(outputLength);
	});

	it("never opens a writable when the plan bails out", async () => {
		const flat = concatBytes([
			buildFtyp(),
			buildMoov([AUDIO_TRACK]),
			makeBox("mdat", new Uint8Array([1, 2, 3])),
		]);
		const fake = createFakeHandles(flat);
		const outcome = await defragmentPartFile(fake.directory, "part-001.mp4");
		// Structural bails are deterministic, so they must not read as transient.
		expect(outcome).toMatchObject({ ok: false, transient: false });
		expect(fake.createWritable).not.toHaveBeenCalled();
	});

	it("aborts the writable when a write fails, keeping the original file", async () => {
		const { bytes } = buildFragmentedMp4([AUDIO_TRACK], AUDIO_ONLY_FRAGMENTS);
		const fake = createFakeHandles(bytes);
		fake.writable.write.mockRejectedValueOnce(new Error("disk full"));
		const outcome = await defragmentPartFile(fake.directory, "part-001.mp4");
		expect(outcome).toMatchObject({ ok: false, transient: true });
		expect(fake.isAborted()).toBe(true);
		expect(fake.isClosed()).toBe(false);
	});

	it("reports a failure when the part file cannot be opened", async () => {
		const directory = {
			getFileHandle: vi.fn(async () => {
				throw new Error("gone");
			}),
		} as unknown as FileSystemDirectoryHandle;
		const outcome = await defragmentPartFile(directory, "part-001.mp4");
		expect(outcome).toMatchObject({ ok: false, transient: true });
	});

	it("marks a read failure (e.g. failed allocation) as transient", async () => {
		const source = {
			size: 1024,
			slice: () => {
				throw new Error("Array buffer allocation failed");
			},
		};
		const fileHandle = {
			getFile: vi.fn(async () => source),
			createWritable: vi.fn(),
		};
		const directory = {
			getFileHandle: vi.fn(async () => fileHandle),
		} as unknown as FileSystemDirectoryHandle;
		const outcome = await defragmentPartFile(directory, "part-001.mp4");
		expect(outcome).toMatchObject({
			ok: false,
			reason: "read_error: Array buffer allocation failed",
			transient: true,
		});
		expect(fileHandle.createWritable).not.toHaveBeenCalled();
	});
});
