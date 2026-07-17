import { t } from "@/utils/i18n";
import {
	createCaptureFinishedMessage,
	getErrorMessage,
	isFatalStopReason,
	reduceStopReason,
} from "./capture-finish";
import { applyPartDiscard } from "./capture-state";
import { createPartFileName, shouldSplitPart } from "./file-system";
import {
	type DefragmentPartOutcome,
	defragmentPartFile,
} from "./mp4-defragment";
import { FORCE_FINALIZE_TIMEOUT_MS } from "./recording-monitor";
import { createSerialTaskQueue } from "./task-queue";
import type {
	CaptureFinishedMessage,
	CaptureMetadata,
	ResolutionChange,
	StopReason,
} from "./types";
import { createMediaRecorderOptions, stopMediaStreamTracks } from "./video";

const CAPTURE_CHUNK_TIMESLICE_MS = 3000;
const MAX_CAPTURE_CHUNK_BYTES = 42 * 1024 * 1024;
const MAX_QUEUED_WRITE_BYTES = 128 * 1024 * 1024;
// Must stay well under the MV3 service worker idle timeout (~30s) so
// keepalive progress messages reach the background before it shuts down.
const POST_PROCESS_KEEPALIVE_INTERVAL_MS = 10_000;

type RecordingPart = {
	index: number;
	fileName: string;
	recorder: MediaRecorder;
	writable: FileSystemWritableFileStream;
	writeQueue: Promise<void>;
	sizeBytes: number;
	chunkCount: number;
	queuedBytes: number;
	stopMode?: "rollover" | "finish";
	finalizing?: boolean;
};

export type RecordingFinishOutcome = {
	message: CaptureFinishedMessage;
	stopReason?: StopReason;
	errorMessage?: string;
	hasSavedParts: boolean;
};

export type RecordingSessionCallbacks = {
	/** Called when a chunk write or part save progresses (used for HUD updates and CAPTURE_PROGRESS messages). */
	onProgress: (metadata: CaptureMetadata) => void;
	/** Called right after stop() is accepted (used to show the "stopping" state in the HUD). */
	onStopping: (elapsedMs: number) => void;
	/** Called when the next part starts. `change` is only set when it originates from a resolution rollover. */
	onPartStarted: (metadata: CaptureMetadata, change?: ResolutionChange) => void;
	/** Called when recording has fully finished. Guaranteed to be called exactly once. */
	onFinished: (outcome: RecordingFinishOutcome) => void;
};

export type RecordingSessionOptions = {
	metadata: CaptureMetadata;
	stream: MediaStream;
	directory: FileSystemDirectoryHandle;
	callbacks: RecordingSessionCallbacks;
	/** Test injection point. Defaults to `new MediaRecorder(stream, options)`. */
	createRecorder?: (
		stream: MediaStream,
		options?: MediaRecorderOptions,
	) => MediaRecorder;
	/** Test injection point. Defaults to `performance.now()`. */
	now?: () => number;
	/** Test injection point. Defaults to `defragmentPartFile`. */
	postProcessPart?: (
		directory: FileSystemDirectoryHandle,
		fileName: string,
	) => Promise<DefragmentPartOutcome>;
};

export type RecordingSession = {
	getMetadata: () => CaptureMetadata;
	isFinished: () => boolean;
	getLastDataAt: () => number;
	isRecorderRecording: () => boolean;
	stop: (
		reason: StopReason,
		errorMessage?: string,
		resolutionChange?: ResolutionChange,
	) => void;
	rollover: (change: ResolutionChange) => void;
};

export type StartRecordingSessionResult =
	| { ok: true; session: RecordingSession }
	| { ok: false; errorMessage?: string };

export async function startRecordingSession(
	options: RecordingSessionOptions,
): Promise<StartRecordingSessionResult> {
	const { stream, directory, callbacks } = options;
	const createRecorder =
		options.createRecorder ??
		((s: MediaStream, recorderOptions?: MediaRecorderOptions) =>
			new MediaRecorder(s, recorderOptions));
	const now = options.now ?? (() => performance.now());
	const postProcessPart = options.postProcessPart ?? defragmentPartFile;
	// Saved parts are defragmented in the background, one at a time; recording
	// of the next part continues meanwhile. finishRecording() waits for this
	// queue so a capture is never reported finished mid-rewrite.
	const postProcessQueue = createSerialTaskQueue();
	// Parts whose rewrite failed for a transient platform reason (e.g. an
	// ArrayBuffer allocation failing while the next part was still recording).
	// They get one more attempt in finishRecording(), after the recorder and
	// its write queues have released their memory.
	const postProcessRetryFileNames: string[] = [];

	let metadata = options.metadata;

	async function createPart(index: number): Promise<RecordingPart> {
		const fileName = createPartFileName(metadata.fileName, metadata.id, index);
		const fileHandle = await directory.getFileHandle(fileName, {
			create: true,
		});
		let writable: FileSystemWritableFileStream | undefined;
		try {
			writable = await fileHandle.createWritable();
			const recorderOptions = createMediaRecorderOptions(
				metadata.mimeType,
				metadata.width,
				metadata.height,
			);
			return {
				index,
				fileName,
				recorder: createRecorder(stream, recorderOptions),
				writable,
				writeQueue: Promise.resolve(),
				sizeBytes: 0,
				chunkCount: 0,
				queuedBytes: 0,
			};
		} catch (error) {
			await writable?.abort().catch(() => undefined);
			await removePartFile(fileName);
			throw error;
		}
	}

	let currentPart: RecordingPart;
	try {
		currentPart = await createPart(1);
	} catch (error) {
		return {
			ok: false,
			errorMessage: getErrorMessage(error, t("mediaRecorderStartFailed")),
		};
	}

	const startedAt = now();
	let finishSent = false;
	let stopReason: StopReason | undefined;
	let errorMessage: string | undefined;
	let pendingResolutionChange: ResolutionChange | undefined;
	let finalizeTimer: number | undefined;
	let lastDataAt = startedAt;

	async function removePartFile(fileName: string): Promise<void> {
		await directory.removeEntry(fileName).catch(() => undefined);
	}

	function setStopReason(reason: StopReason, message?: string): void {
		const next = reduceStopReason(
			{ stopReason, errorMessage },
			{ stopReason: reason, errorMessage: message },
		);
		stopReason = next.stopReason;
		errorMessage = next.errorMessage;
	}

	function startPart(part: RecordingPart): void {
		lastDataAt = now();
		part.recorder.ondataavailable = (event) => {
			lastDataAt = now();
			enqueueChunk(part, event.data);
		};
		part.recorder.onerror = (event) => {
			stopSession(
				"error",
				(event as ErrorEvent).message || t("recordingErrorOccurred"),
			);
		};
		part.recorder.onstop = () => {
			void finalizeStoppedPart(part);
		};
		part.recorder.start(CAPTURE_CHUNK_TIMESLICE_MS);
	}

	function enqueueChunk(part: RecordingPart, blob: Blob): void {
		if (blob.size <= 0 || finishSent) {
			return;
		}
		if (
			blob.size > MAX_CAPTURE_CHUNK_BYTES ||
			part.queuedBytes + blob.size > MAX_QUEUED_WRITE_BYTES
		) {
			stopSession("write_failed", t("writeBackpressureStopped"));
			return;
		}

		part.queuedBytes += blob.size;
		part.writeQueue = part.writeQueue
			.then(() => writeChunk(part, blob))
			.catch((error: unknown) => {
				setStopReason(
					"write_failed",
					getErrorMessage(error, t("recordingDataWriteFailed")),
				);
				stopPart(part, "finish");
			})
			.finally(() => {
				part.queuedBytes -= blob.size;
			});
	}

	async function writeChunk(part: RecordingPart, blob: Blob): Promise<void> {
		await part.writable.write(blob);
		part.sizeBytes += blob.size;
		part.chunkCount += 1;
		metadata = {
			...metadata,
			sizeBytes: metadata.sizeBytes + blob.size,
			elapsedMs: now() - startedAt,
			chunkCount: metadata.chunkCount + 1,
			currentPartSizeBytes: part.sizeBytes,
		};
		callbacks.onProgress(metadata);
		if (shouldSplitPart(part.sizeBytes) && !part.stopMode && !stopReason) {
			stopPart(part, "rollover", { requestData: true });
		}
	}

	function stopSession(
		reason: StopReason,
		message?: string,
		resolutionChange?: ResolutionChange,
	): void {
		if (finishSent) {
			return;
		}
		if (resolutionChange) {
			metadata = { ...metadata, resolutionChange };
		}
		setStopReason(reason, message);
		callbacks.onStopping(now() - startedAt);
		stopPart(currentPart, "finish", { requestData: true });
		if (!finalizeTimer) {
			finalizeTimer = window.setTimeout(() => {
				finalizeTimer = undefined;
				if (!finishSent) {
					void finalizeStoppedPart(currentPart);
				}
			}, FORCE_FINALIZE_TIMEOUT_MS);
		}
	}

	function rolloverSession(change: ResolutionChange): void {
		if (currentPart.stopMode || stopReason || finishSent) {
			return;
		}
		pendingResolutionChange = change;
		metadata = {
			...metadata,
			width: change.to.width,
			height: change.to.height,
		};
		stopPart(currentPart, "rollover", { requestData: true });
	}

	function stopPart(
		part: RecordingPart,
		stopMode: NonNullable<RecordingPart["stopMode"]>,
		partOptions: { requestData?: boolean } = {},
	): void {
		if (part.recorder.state === "inactive") {
			return;
		}
		part.stopMode = stopMode;
		if (partOptions.requestData) {
			part.recorder.requestData();
		}
		part.recorder.stop();
	}

	async function finalizeStoppedPart(part: RecordingPart): Promise<void> {
		if (finishSent || currentPart !== part) {
			return;
		}
		if (part.finalizing) {
			return;
		}
		part.finalizing = true;
		try {
			await part.writeQueue;
			if (isFatalStopReason(stopReason) || part.sizeBytes === 0) {
				await discardCurrentPart(part);
			} else {
				await saveCurrentPart(part);
			}
		} catch (error) {
			await discardCurrentPart(part);
			setStopReason(
				"write_failed",
				getErrorMessage(error, t("recordingFileFinalizeFailed")),
			);
		}

		if (part.stopMode === "rollover" && !stopReason) {
			const started = await startNextPart(part.index + 1);
			if (started) {
				return;
			}
		}
		await finishRecording();
	}

	async function startNextPart(index: number): Promise<boolean> {
		try {
			const nextPart = await createPart(index);
			const pendingChange = pendingResolutionChange;
			currentPart = nextPart;
			metadata = {
				...metadata,
				partCount: nextPart.index,
				currentPartSizeBytes: 0,
				resolutionChanges: pendingChange
					? [
							...(metadata.resolutionChanges ?? []),
							{ ...pendingChange, partIndex: nextPart.index },
						]
					: metadata.resolutionChanges,
			};
			pendingResolutionChange = undefined;
			startPart(nextPart);
			callbacks.onPartStarted(metadata, pendingChange);
			return true;
		} catch (error) {
			setStopReason(
				"write_failed",
				getErrorMessage(error, t("nextRecordingFileCreateFailed")),
			);
			return false;
		}
	}

	async function saveCurrentPart(part: RecordingPart): Promise<void> {
		await part.writable.close();
		metadata = {
			...metadata,
			savedPartCount: (metadata.savedPartCount ?? 0) + 1,
		};
		callbacks.onProgress(metadata);
		postProcessQueue.enqueue(async () => {
			const outcome = await runPostProcess(part.fileName);
			if (outcome.ok) {
				return;
			}
			if (outcome.transient) {
				console.warn(
					`[recordly] defragmenting ${part.fileName} failed (${outcome.reason}); retrying once recording has stopped`,
				);
				postProcessRetryFileNames.push(part.fileName);
				return;
			}
			warnKeepingFragmented(part.fileName, outcome.reason);
		});
	}

	async function runPostProcess(
		fileName: string,
	): Promise<DefragmentPartOutcome> {
		return postProcessPart(directory, fileName).catch((error: unknown) => ({
			ok: false as const,
			reason: getErrorMessage(error, "post-processing failed"),
		}));
	}

	function warnKeepingFragmented(fileName: string, reason: string): void {
		// Best effort: the fragmented original stays valid, just slower to start
		// playing over a network.
		console.warn(
			`[recordly] keeping fragmented MP4 for ${fileName}: ${reason}`,
		);
	}

	async function discardCurrentPart(part: RecordingPart): Promise<void> {
		await part.writable.abort().catch(() => undefined);
		await removePartFile(part.fileName);
		discardPartProgress(part);
	}

	function discardPartProgress(part: RecordingPart): void {
		metadata = applyPartDiscard(metadata, part);
	}

	async function finishRecording(): Promise<void> {
		if (finishSent) {
			return;
		}
		finishSent = true;
		if (finalizeTimer) {
			window.clearTimeout(finalizeTimer);
			finalizeTimer = undefined;
		}
		stopMediaStreamTracks(stream);
		// Keep the HUD in its "finalizing" state until every saved part has been
		// defragmented (or its rewrite has bailed out). No chunks flow while that
		// runs, so heartbeat progress callbacks keep the background service
		// worker's idle timer from expiring and disconnecting the port.
		const keepAliveTimer = window.setInterval(() => {
			callbacks.onProgress(metadata);
		}, POST_PROCESS_KEEPALIVE_INTERVAL_MS);
		await postProcessQueue.settled();
		// The recorder is stopped and its write queues are drained, so a rewrite
		// that failed under recording-time memory pressure gets one more chance.
		for (const fileName of postProcessRetryFileNames) {
			const outcome = await runPostProcess(fileName);
			if (!outcome.ok) {
				warnKeepingFragmented(fileName, outcome.reason);
			}
		}
		window.clearInterval(keepAliveTimer);
		const hasSavedParts = (metadata.savedPartCount ?? 0) > 0;
		const message = createCaptureFinishedMessage(metadata, {
			stopReason,
			errorMessage,
			elapsedMs: now() - startedAt,
		});
		callbacks.onFinished({ message, stopReason, errorMessage, hasSavedParts });
	}

	try {
		startPart(currentPart);
	} catch (error) {
		await currentPart.writable.abort();
		await removePartFile(currentPart.fileName);
		return {
			ok: false,
			errorMessage: getErrorMessage(error, t("mediaRecorderStartFailed")),
		};
	}

	const session: RecordingSession = {
		getMetadata: () => metadata,
		isFinished: () => finishSent,
		getLastDataAt: () => lastDataAt,
		isRecorderRecording: () => currentPart.recorder.state === "recording",
		stop: stopSession,
		rollover: rolloverSession,
	};
	return { ok: true, session };
}
