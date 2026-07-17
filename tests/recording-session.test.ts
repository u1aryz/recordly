import { afterEach, describe, expect, it, vi } from "vitest";
import { createPartFileName, PART_SPLIT_BYTES } from "@/shared/file-system";
import type { DefragmentPartOutcome } from "@/shared/mp4-defragment";
import {
	type RecordingSessionCallbacks,
	startRecordingSession,
} from "@/shared/recording-session";
import type { CaptureMetadata } from "@/shared/types";

// Keeps the real defragmenter out of these tests; its behavior is covered by
// tests/mp4-defragment.test.ts.
const stubPostProcessPart = async () => ({ ok: true as const });

function createMetadata(
	overrides: Partial<CaptureMetadata> = {},
): CaptureMetadata {
	return {
		id: "capture-1",
		videoId: "video-1",
		tabId: 1,
		pageUrl: "https://example.test",
		title: "Demo",
		startedAt: 0,
		status: "recording",
		fileStatus: "writing",
		mimeType: "video/mp4",
		fileName: "demo.mp4",
		sizeBytes: 0,
		elapsedMs: 0,
		width: 1920,
		height: 1080,
		chunkCount: 0,
		storageMode: "segmented-files",
		scope: "element",
		partCount: 1,
		savedPartCount: 0,
		currentPartSizeBytes: 0,
		...overrides,
	};
}

type FakeRecorderHandle = {
	recorder: MediaRecorder;
	getState: () => "inactive" | "recording" | "paused";
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	requestData: ReturnType<typeof vi.fn>;
	emitData: (size: number) => void;
	emitStop: () => void;
	emitError: (message: string) => void;
};

function createFakeRecorder(): FakeRecorderHandle {
	let state: "inactive" | "recording" | "paused" = "inactive";
	let ondataavailable: ((event: { data: Blob }) => void) | null = null;
	let onerror: ((event: unknown) => void) | null = null;
	let onstop: (() => void) | null = null;
	const start = vi.fn(() => {
		state = "recording";
	});
	const stop = vi.fn(() => {
		state = "inactive";
	});
	const requestData = vi.fn();
	const recorder = {
		get state() {
			return state;
		},
		set ondataavailable(handler: ((event: { data: Blob }) => void) | null) {
			ondataavailable = handler;
		},
		get ondataavailable() {
			return ondataavailable;
		},
		set onerror(handler: ((event: unknown) => void) | null) {
			onerror = handler;
		},
		get onerror() {
			return onerror;
		},
		set onstop(handler: (() => void) | null) {
			onstop = handler;
		},
		get onstop() {
			return onstop;
		},
		start,
		stop,
		requestData,
	} as unknown as MediaRecorder;

	return {
		recorder,
		getState: () => state,
		start,
		stop,
		requestData,
		emitData: (size: number) => {
			ondataavailable?.({ data: { size } as Blob });
		},
		emitStop: () => {
			state = "inactive";
			onstop?.();
		},
		emitError: (message: string) => {
			onerror?.({ message } as ErrorEvent);
		},
	};
}

function createRecorderFactory() {
	const handles: FakeRecorderHandle[] = [];
	const createRecorder = vi.fn(() => {
		const handle = createFakeRecorder();
		handles.push(handle);
		return handle.recorder;
	});
	return { createRecorder, handles };
}

type FakeWritable = {
	writable: FileSystemWritableFileStream;
	write: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	abort: ReturnType<typeof vi.fn>;
	writtenBytes: number;
};

function createFakeWritable(
	overrides: {
		writeImpl?: (chunk: Blob) => Promise<void>;
		closeImpl?: () => Promise<void>;
	} = {},
): FakeWritable {
	const state = { writtenBytes: 0 };
	const write = vi.fn(
		overrides.writeImpl ??
			(async (chunk: Blob) => {
				state.writtenBytes += chunk.size;
			}),
	);
	const close = vi.fn(overrides.closeImpl ?? (async () => undefined));
	const abort = vi.fn(async () => undefined);
	const writable = {
		write,
		close,
		abort,
	} as unknown as FileSystemWritableFileStream;
	return {
		writable,
		write,
		close,
		abort,
		get writtenBytes() {
			return state.writtenBytes;
		},
	} as FakeWritable;
}

function createFakeDirectory(
	createWritableForFile: (
		fileName: string,
	) =>
		| Promise<FileSystemWritableFileStream>
		| FileSystemWritableFileStream = () => createFakeWritable().writable,
) {
	const removedFiles: string[] = [];
	const getFileHandle = vi.fn(async (fileName: string) => {
		return {
			createWritable: vi.fn(async () => createWritableForFile(fileName)),
		};
	});
	const removeEntry = vi.fn(async (fileName: string) => {
		removedFiles.push(fileName);
	});
	const directory = {
		getFileHandle,
		removeEntry,
	} as unknown as FileSystemDirectoryHandle;
	return { directory, removedFiles, getFileHandle, removeEntry };
}

function createFakeStream() {
	const track = { stop: vi.fn() };
	const stream = { getTracks: () => [track] } as unknown as MediaStream;
	return { stream, track };
}

function createCallbacks(): RecordingSessionCallbacks {
	return {
		onProgress: vi.fn(),
		onStopping: vi.fn(),
		onPartStarted: vi.fn(),
		onFinished: vi.fn(),
	};
}

function createNow(initial = 0) {
	let current = initial;
	return {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		},
	};
}

// Chaining Promise.resolve() would require counting ticks equal to the depth
// of the async chain, which is easy to get wrong, so instead advance to a
// macrotask boundary (setTimeout) to flush all pending microtasks at once.
// When fake timers are in use, internal processing such as enqueueChunk is
// unaffected since it runs as a microtask.
async function flushMicrotasks(times = 1): Promise<void> {
	for (let i = 0; i < times; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

// PART_SPLIT_BYTES (2GiB) far exceeds MAX_CAPTURE_CHUNK_BYTES (42MB), so a
// single emitData call would be rejected as a write. Drain the write queue
// each time while stacking chunks below the limit, growing the current part
// up to the target size.
async function growPartTo(
	handle: FakeRecorderHandle,
	targetBytes: number,
): Promise<void> {
	const CHUNK_BYTES = 40 * 1024 * 1024;
	let written = 0;
	while (written < targetBytes) {
		const size = Math.min(CHUNK_BYTES, targetBytes - written);
		handle.emitData(size);
		written += size;
		await flushMicrotasks();
	}
}

afterEach(() => {
	vi.useRealTimers();
});

describe("startRecordingSession", () => {
	it("writes chunks serially and reports progress", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();
		const { now } = createNow();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			now,
			postProcessPart: stubPostProcessPart,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		const recorder = handles[0];
		recorder.emitData(100);
		await flushMicrotasks();
		recorder.emitData(200);
		await flushMicrotasks();

		expect(result.session.getMetadata().sizeBytes).toBe(300);
		expect(result.session.getMetadata().chunkCount).toBe(2);
		expect(callbacks.onProgress).toHaveBeenCalledTimes(2);
	});

	it("stops with write_failed when a single chunk exceeds the byte limit", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(43 * 1024 * 1024);
		await flushMicrotasks();
		handles[0].emitStop();
		await flushMicrotasks();

		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.stopReason).toBe("write_failed");
	});

	it("stops with write_failed when the write queue backs up past the limit", async () => {
		// Reproduce a backpressure situation where the queue backs up unresolved
		// by synchronously stacking multiple chunks before write() resolves.
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(40 * 1024 * 1024);
		handles[0].emitData(40 * 1024 * 1024);
		handles[0].emitData(40 * 1024 * 1024);
		handles[0].emitData(40 * 1024 * 1024);
		await flushMicrotasks();
		handles[0].emitStop();
		await flushMicrotasks();

		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.stopReason).toBe("write_failed");
	});

	it("rolls over to a new part once the 2GiB soft limit is reached", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		await growPartTo(handles[0], PART_SPLIT_BYTES);

		expect(handles[0].requestData).toHaveBeenCalledTimes(1);
		expect(handles[0].stop).toHaveBeenCalledTimes(1);

		handles[0].emitStop();
		await flushMicrotasks();

		expect(handles).toHaveLength(2);
		expect(handles[1].start).toHaveBeenCalledTimes(1);
		expect(callbacks.onPartStarted).toHaveBeenCalledTimes(1);
		const [partMetadata, change] = (
			callbacks.onPartStarted as ReturnType<typeof vi.fn>
		).mock.calls[0];
		expect(partMetadata.partCount).toBe(2);
		expect(change).toBeUndefined();
		expect(result.session.getMetadata().savedPartCount).toBe(1);
	});

	it("rolls over on a resolution change and records it against the new part", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		const change = {
			from: { width: 1920, height: 1080 },
			to: { width: 1280, height: 720 },
		};
		result.session.rollover(change);
		expect(handles[0].requestData).toHaveBeenCalledTimes(1);
		handles[0].emitStop();
		await flushMicrotasks();

		expect(handles).toHaveLength(2);
		const metadata = result.session.getMetadata();
		expect(metadata.width).toBe(1280);
		expect(metadata.height).toBe(720);
		expect(metadata.resolutionChanges).toEqual([{ ...change, partIndex: 2 }]);
		const [, passedChange] = (
			callbacks.onPartStarted as ReturnType<typeof vi.fn>
		).mock.calls[0];
		expect(passedChange).toEqual(change);
	});

	it("ignores rollover once a stop is already in progress", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		result.session.stop("user");
		handles[0].requestData.mockClear();
		result.session.rollover({
			from: { width: 1920, height: 1080 },
			to: { width: 1280, height: 720 },
		});
		expect(handles[0].requestData).not.toHaveBeenCalled();
	});

	it("finishes as complete when the user stops after saving data", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(1024);
		await flushMicrotasks();
		result.session.stop("user");
		expect(callbacks.onStopping).toHaveBeenCalledTimes(1);
		handles[0].emitStop();
		await flushMicrotasks();

		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.message.status).toBe("complete");
		expect(outcome.message.fileStatus).toBe("saved");
		expect(outcome.message.stopReason).toBeUndefined();
		expect(outcome.hasSavedParts).toBe(true);
	});

	it("discards an empty part and reports a failed fileStatus", async () => {
		const { directory, removedFiles } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		result.session.stop("user");
		handles[0].emitStop();
		await flushMicrotasks();

		expect(removedFiles).toHaveLength(1);
		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.hasSavedParts).toBe(false);
		expect(outcome.message.fileStatus).toBe("failed");
	});

	it("discards the part and marks write_failed when a write rejects", async () => {
		const { directory } = createFakeDirectory(
			() =>
				createFakeWritable({
					writeImpl: () => Promise.reject(new Error("disk full")),
				}).writable,
		);
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(1024);
		await flushMicrotasks();
		handles[0].emitStop();
		await flushMicrotasks();

		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.stopReason).toBe("write_failed");
		expect(outcome.errorMessage).toBe("disk full");
		expect(outcome.hasSavedParts).toBe(false);
	});

	it("discards on finalize failure and reports stopped when parts were already saved", async () => {
		let call = 0;
		const { directory } = createFakeDirectory((_fileName) => {
			call += 1;
			if (call === 1) {
				return createFakeWritable().writable;
			}
			return createFakeWritable({
				closeImpl: () => Promise.reject(new Error("finalize failed")),
			}).writable;
		});
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		await growPartTo(handles[0], PART_SPLIT_BYTES);
		handles[0].emitStop();
		await flushMicrotasks();
		expect(handles).toHaveLength(2);

		handles[1].emitData(1024);
		await flushMicrotasks();
		result.session.stop("user");
		handles[1].emitStop();
		await flushMicrotasks();

		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.stopReason).toBe("write_failed");
		expect(outcome.message.status).toBe("stopped");
	});

	it("force-finalizes once the onstop event never arrives", async () => {
		vi.useFakeTimers();
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		result.session.stop("user");
		await vi.advanceTimersByTimeAsync(8000);

		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
		void handles;
	});

	it("finalizes exactly once when onstop fires alongside the force-finalize timer", async () => {
		vi.useFakeTimers();
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		result.session.stop("user");
		handles[0].emitStop();
		handles[0].emitStop();
		await vi.advanceTimersByTimeAsync(8000);

		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
	});

	it("stops with write_failed when creating the next part fails, keeping stopped status", async () => {
		let call = 0;
		const { directory } = createFakeDirectory(() => {
			call += 1;
			if (call === 1) {
				return createFakeWritable().writable;
			}
			throw new Error("no space left");
		});
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		await growPartTo(handles[0], PART_SPLIT_BYTES);
		handles[0].emitStop();
		await flushMicrotasks(10);

		expect(handles).toHaveLength(1);
		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.stopReason).toBe("write_failed");
		expect(outcome.message.status).toBe("stopped");
	});

	it("stops every stream track once finished", async () => {
		const { directory } = createFakeDirectory();
		const { stream, track } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		result.session.stop("user");
		handles[0].emitStop();
		await flushMicrotasks();

		expect(track.stop).toHaveBeenCalledTimes(1);
	});

	it("post-processes each saved part and skips discarded parts", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();
		const postProcessPart = vi.fn(async () => ({ ok: true as const }));

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		// Part 1 rolls over (saved); part 2 stops with no data (discarded).
		await growPartTo(handles[0], PART_SPLIT_BYTES);
		handles[0].emitStop();
		await flushMicrotasks();
		expect(handles).toHaveLength(2);
		result.session.stop("user");
		handles[1].emitStop();
		await flushMicrotasks();

		expect(postProcessPart).toHaveBeenCalledTimes(1);
		expect(postProcessPart).toHaveBeenCalledWith(
			directory,
			createPartFileName("demo.mp4", "capture-1", 1),
			expect.any(Function),
		);
	});

	it("reports defragment progress while a saved part is rewritten", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const onPostProcessProgress = vi.fn();
		const callbacks = { ...createCallbacks(), onPostProcessProgress };
		const postProcessPart = vi.fn(
			async (
				_directory: FileSystemDirectoryHandle,
				_fileName: string,
				onProgress?: (bytesWritten: number, totalBytes: number) => void,
			) => {
				onProgress?.(512, 1024);
				onProgress?.(1024, 1024);
				return { ok: true as const };
			},
		);

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(1024);
		await flushMicrotasks();
		result.session.stop("user");
		handles[0].emitStop();
		await flushMicrotasks();

		// The display holds at 99% after the last byte: the part's writable is
		// still committing (close) until the outcome resolves.
		expect(
			onPostProcessProgress.mock.calls.map(([progress]) => progress),
		).toEqual([
			{ currentPart: 1, totalParts: 1, percent: 0 },
			{ currentPart: 1, totalParts: 1, percent: 50 },
			{ currentPart: 1, totalParts: 1, percent: 99 },
			{ currentPart: 1, totalParts: 1, percent: 100 },
		]);
	});

	it("weights overall defragment progress by part size", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const onPostProcessProgress = vi.fn();
		const callbacks = { ...createCallbacks(), onPostProcessProgress };
		const postProcessPart = vi.fn(async () => ({ ok: true as const }));

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		// Part 1 rolls over at the split size; part 2 stays tiny.
		await growPartTo(handles[0], PART_SPLIT_BYTES);
		handles[0].emitStop();
		await flushMicrotasks();
		handles[1].emitData(1024);
		await flushMicrotasks();
		result.session.stop("user");
		handles[1].emitStop();
		await flushMicrotasks();

		// The overall percent is byte-weighted, so the finished 2 GiB part keeps
		// the bar near-complete once the tiny final part joins the total.
		expect(
			onPostProcessProgress.mock.calls.map(([progress]) => progress),
		).toEqual([
			{ currentPart: 1, totalParts: 1, percent: 0 },
			{ currentPart: 1, totalParts: 1, percent: 100 },
			{ currentPart: 2, totalParts: 2, percent: 99 },
			{ currentPart: 2, totalParts: 2, percent: 100 },
		]);
	});

	it("delays onFinished until the final part's post-processing completes", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();
		let resolvePostProcess: (() => void) | undefined;
		const postProcessPart = vi.fn(
			() =>
				new Promise<{ ok: true }>((resolve) => {
					resolvePostProcess = () => resolve({ ok: true });
				}),
		);

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(1024);
		await flushMicrotasks();
		result.session.stop("user");
		handles[0].emitStop();
		await flushMicrotasks();

		expect(postProcessPart).toHaveBeenCalledTimes(1);
		expect(callbacks.onFinished).not.toHaveBeenCalled();

		resolvePostProcess?.();
		await flushMicrotasks();
		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
	});

	it("sends progress heartbeats while post-processing delays the finish", async () => {
		vi.useFakeTimers();
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();
		let resolvePostProcess: (() => void) | undefined;
		const postProcessPart = vi.fn(
			() =>
				new Promise<{ ok: true }>((resolve) => {
					resolvePostProcess = () => resolve({ ok: true });
				}),
		);

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(1024);
		await vi.advanceTimersByTimeAsync(0);
		result.session.stop("user");
		handles[0].emitStop();
		// Zero-advance twice to drain the multi-await finalize chain, so the
		// keepalive interval is registered (and saveCurrentPart's onProgress
		// call is counted) before sampling the call count below.
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(0);

		// The recording is now waiting on post-processing; heartbeats keep the
		// background service worker alive across the silent window.
		const onProgress = callbacks.onProgress as ReturnType<typeof vi.fn>;
		const callsBefore = onProgress.mock.calls.length;
		await vi.advanceTimersByTimeAsync(30_000);
		const callsDuring = onProgress.mock.calls.length;
		expect(callsDuring).toBeGreaterThan(callsBefore);
		expect(callbacks.onFinished).not.toHaveBeenCalled();

		resolvePostProcess?.();
		await vi.advanceTimersByTimeAsync(0);
		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);

		// The heartbeat stops once the session has finished.
		await vi.advanceTimersByTimeAsync(60_000);
		expect(onProgress.mock.calls.length).toBe(callsDuring);
	});

	it("starts the next part without waiting for the previous part's post-processing", async () => {
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();
		const resolvers: (() => void)[] = [];
		const postProcessPart = vi.fn(
			() =>
				new Promise<{ ok: true }>((resolve) => {
					resolvers.push(() => resolve({ ok: true }));
				}),
		);

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		await growPartTo(handles[0], PART_SPLIT_BYTES);
		handles[0].emitStop();
		await flushMicrotasks();

		// Recording continues on part 2 while part 1 is still being rewritten.
		expect(callbacks.onPartStarted).toHaveBeenCalledTimes(1);
		expect(handles).toHaveLength(2);
		expect(resolvers).toHaveLength(1);

		handles[1].emitData(1024);
		await flushMicrotasks();
		result.session.stop("user");
		handles[1].emitStop();
		await flushMicrotasks();
		expect(callbacks.onFinished).not.toHaveBeenCalled();

		// The serial queue finishes part 1's rewrite before part 2's.
		resolvers[0]();
		await flushMicrotasks();
		expect(resolvers).toHaveLength(2);
		resolvers[1]();
		await flushMicrotasks();
		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
	});

	it("keeps the capture successful when post-processing fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();
		const postProcessPart = vi.fn(async () => ({
			ok: false as const,
			reason: "unsupported_box_layout",
		}));

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(1024);
		await flushMicrotasks();
		result.session.stop("user");
		handles[0].emitStop();
		await flushMicrotasks();

		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.message.status).toBe("complete");
		expect(outcome.message.fileStatus).toBe("saved");
		expect(outcome.message.savedPartCount).toBe(1);
		// Structural failures are deterministic, so no retry is attempted.
		expect(postProcessPart).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it("retries a transient post-processing failure after recording stops", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { directory } = createFakeDirectory();
		const { stream } = createFakeStream();
		const { createRecorder, handles } = createRecorderFactory();
		const callbacks = createCallbacks();
		const outcomes: DefragmentPartOutcome[] = [
			{
				ok: false,
				reason: "read_error: Array buffer allocation failed",
				transient: true,
			},
			{ ok: true },
		];
		const postProcessPart = vi.fn(
			async () => outcomes.shift() ?? { ok: true as const },
		);

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart,
		});
		if (!result.ok) {
			throw new Error("expected session to start");
		}

		handles[0].emitData(1024);
		await flushMicrotasks();
		result.session.stop("user");
		handles[0].emitStop();
		await flushMicrotasks();

		expect(postProcessPart).toHaveBeenCalledTimes(2);
		expect(postProcessPart).toHaveBeenNthCalledWith(
			2,
			directory,
			createPartFileName("demo.mp4", "capture-1", 1),
			undefined,
		);
		expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
		const outcome = (callbacks.onFinished as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(outcome.message.status).toBe("complete");
		expect(outcome.message.fileStatus).toBe("saved");
		// Only the retry notice is logged; the retry succeeded.
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it("rolls back and reports failure when the recorder cannot be created", async () => {
		const { directory, removedFiles } = createFakeDirectory();
		const { stream } = createFakeStream();
		const callbacks = createCallbacks();
		const createRecorder = vi.fn(() => {
			throw new Error("recorder unavailable");
		});

		const result = await startRecordingSession({
			metadata: createMetadata(),
			stream,
			directory,
			callbacks,
			createRecorder,
			postProcessPart: stubPostProcessPart,
		});

		expect(result.ok).toBe(false);
		expect(removedFiles).toHaveLength(1);
	});
});
