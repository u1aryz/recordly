import {
	createCaptureFinishedMessage,
	createProgressMessage,
	getErrorMessage,
	getHudResult,
	isFatalStopReason,
	reduceStopReason,
} from "@/shared/capture-finish";
import {
	createCaptureMetadata,
	markResolutionChangeFileDiscarded,
} from "@/shared/capture-state";
import {
	createPartFileName,
	isFilePickerAbortError,
	shouldSplitPart,
} from "@/shared/file-system";
import { isExtensionMessage } from "@/shared/message";
import {
	createRecordingHudManager,
	type RecordingHudManager,
} from "@/shared/recording-hud";
import {
	createMonitorState,
	evaluateRecordingTick,
	FORCE_FINALIZE_TIMEOUT_MS,
	type MonitorState,
} from "@/shared/recording-monitor";
import {
	continueOnResolutionChange,
	recordingHudPosition,
} from "@/shared/settings";
import type {
	CaptureMetadata,
	CaptureStreamPortMessage,
	ResolutionChange,
	StopReason,
	VideoDescriptor,
	VideoResolution,
} from "@/shared/types";
import {
	createMediaRecorderOptions,
	createVideoCaptureStream,
	describeVideo,
	formatResolution,
	getMp4MimeType,
	isVideoConnected,
	listVideos,
} from "@/shared/video";
import {
	createVideoPicker,
	type VideoPickerStartResult,
} from "@/shared/video-picker";
import { t } from "@/utils/i18n";

type ActiveRecording = {
	metadata: CaptureMetadata;
	stream: MediaStream;
	directory: FileSystemDirectoryHandle;
	part: RecordingPart;
	port: Browser.runtime.Port;
	startedAt: number;
	resolutionTimer: number;
	finishSent: boolean;
	stopReason?: StopReason;
	errorMessage?: string;
	continueOnResolutionChange: boolean;
	monitorState: MonitorState;
	lastDataAt: number;
	finalizeTimer?: number;
	pendingResolutionChange?: ResolutionChange;
};

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

const CAPTURE_CHUNK_TIMESLICE_MS = 3000;
const MAX_CAPTURE_CHUNK_BYTES = 42 * 1024 * 1024;
const MAX_QUEUED_WRITE_BYTES = 128 * 1024 * 1024;
const activeRecordings = new Map<string, ActiveRecording>();
let recordingHud: RecordingHudManager | undefined;

export default defineContentScript({
	matches: ["<all_urls>"],
	allFrames: false,
	runAt: "document_idle",
	main(ctx) {
		recordingHud = createRecordingHudManager({
			getPosition() {
				return recordingHudPosition.getValue();
			},
			onOpen(captureId) {
				void browser.runtime.sendMessage({ type: "OPEN_CAPTURES", captureId });
			},
			onPositionChange(position) {
				return recordingHudPosition.setValue(position);
			},
			onStop(captureId) {
				stopCapture(captureId, "user");
			},
		});
		const picker = createVideoPicker({ onStart: startRecording });

		browser.runtime.onMessage.addListener((message: unknown) => {
			if (!isExtensionMessage(message)) {
				return undefined;
			}
			switch (message.type) {
				case "LIST_VIDEOS":
					return Promise.resolve({ videos: listCapturableVideos() });
				case "START_PICKER":
					picker.start();
					return Promise.resolve({ ok: true });
				case "STOP_CAPTURE":
					stopCapture(message.captureId, "user");
					return Promise.resolve({ ok: true });
				default:
					return undefined;
			}
		});

		function onPageHide(): void {
			stopAllRecordings("source_closed");
		}
		window.addEventListener("pagehide", onPageHide);

		ctx.onInvalidated(() => {
			picker.destroy();
			window.removeEventListener("pagehide", onPageHide);
			stopAllRecordings("error", t("recordingStoppedAfterExtensionUpdate"));
			recordingHud?.destroy();
			recordingHud = undefined;
		});
	},
});

async function startRecording(
	video: HTMLVideoElement,
): Promise<VideoPickerStartResult> {
	if (!window.showDirectoryPicker) {
		return {
			ok: false,
			reason: t("directFolderSaveUnsupported"),
		};
	}

	const descriptor = describeVideo(video);
	const existing = findActiveRecordingByVideoId(descriptor.id);
	if (existing) {
		recordingHud?.highlight(existing.metadata.id);
		return {
			ok: false,
			reason: t("videoAlreadyRecording"),
		};
	}
	const mimeType = getMp4MimeType();
	if (!mimeType) {
		return {
			ok: false,
			reason: t("mediaRecorderMp4Unsupported"),
		};
	}
	const metadata = createCaptureMetadata({
		videoId: descriptor.id,
		tabId: 0,
		pageUrl: location.href,
		title: descriptor.title,
		mimeType,
		width: descriptor.width,
		height: descriptor.height,
		thumbnailDataUrl: createThumbnail(video),
		status: "recording",
		fileStatus: "writing",
		storageMode: "segmented-files",
		scope: "element",
	});

	let directory: FileSystemDirectoryHandle;
	try {
		directory = await window.showDirectoryPicker({
			id: "recordly-captures",
			mode: "readwrite",
			startIn: "downloads",
		});
	} catch (error) {
		if (isFilePickerAbortError(error)) {
			return { ok: false, cancelled: true };
		}
		return {
			ok: false,
			reason: getErrorMessage(error, t("destinationPickFailed")),
		};
	}

	const { stream, errorMessage } = createVideoCaptureStream(video);
	if (!stream) {
		return {
			ok: false,
			reason: errorMessage ?? t("captureStreamUnsupported"),
		};
	}

	let part: RecordingPart | undefined;
	try {
		part = await createRecordingPart(directory, metadata, stream, 1);
	} catch (error) {
		stopStream(stream);
		return {
			ok: false,
			reason: getErrorMessage(error, t("mediaRecorderStartFailed")),
		};
	}

	const port = browser.runtime.connect({ name: "capture-stream" });
	const startedAt = performance.now();
	const continueOnResolutionChangeEnabled =
		await continueOnResolutionChange.getValue();
	const active: ActiveRecording = {
		metadata,
		stream,
		directory,
		part,
		port,
		startedAt,
		resolutionTimer: 0,
		finishSent: false,
		continueOnResolutionChange: continueOnResolutionChangeEnabled,
		monitorState: createMonitorState(),
		lastDataAt: startedAt,
	};
	activeRecordings.set(metadata.id, active);
	recordingHud?.add(metadata);
	bindRecordingEvents(active, video);
	try {
		startPart(active);
	} catch (error) {
		window.clearInterval(active.resolutionTimer);
		activeRecordings.delete(metadata.id);
		port.disconnect();
		stopStream(stream);
		await part.writable.abort();
		await removePartFile(directory, part.fileName);
		recordingHud?.remove(metadata.id);
		return {
			ok: false,
			reason: getErrorMessage(error, t("mediaRecorderStartFailed")),
		};
	}
	postCaptureStreamMessage(port, { type: "CAPTURE_STARTED", metadata });
	recordingHud?.update(metadata.id, 0);
	return { ok: true };
}

function findActiveRecordingByVideoId(
	videoId: string,
): ActiveRecording | undefined {
	for (const active of activeRecordings.values()) {
		if (active.metadata.videoId === videoId && !active.finishSent) {
			return active;
		}
	}
	return undefined;
}

function bindRecordingEvents(
	active: ActiveRecording,
	video: HTMLVideoElement,
): void {
	const captureId = active.metadata.id;
	active.port.onDisconnect.addListener(() => {
		if (activeRecordings.has(captureId)) {
			stopCapture(captureId, "error", t("recordingStatusConnectionLost"));
		}
	});
	video.addEventListener("ended", () => stopCapture(captureId, "video_ended"), {
		once: true,
	});
	for (const track of active.stream.getTracks()) {
		track.addEventListener(
			"ended",
			() => stopCapture(captureId, "source_closed"),
			{ once: true },
		);
	}
	active.resolutionTimer = createResolutionTimer(video, active);
}

async function createRecordingPart(
	directory: FileSystemDirectoryHandle,
	metadata: CaptureMetadata,
	stream: MediaStream,
	index: number,
): Promise<RecordingPart> {
	const fileName = createPartFileName(metadata.fileName, metadata.id, index);
	const fileHandle = await directory.getFileHandle(fileName, { create: true });
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
			recorder: new MediaRecorder(stream, recorderOptions),
			writable,
			writeQueue: Promise.resolve(),
			sizeBytes: 0,
			chunkCount: 0,
			queuedBytes: 0,
		};
	} catch (error) {
		await writable?.abort().catch(() => undefined);
		await removePartFile(directory, fileName);
		throw error;
	}
}

function startPart(active: ActiveRecording): void {
	const part = active.part;
	active.lastDataAt = performance.now();
	part.recorder.ondataavailable = (event) => {
		active.lastDataAt = performance.now();
		enqueueChunk(active, part, event.data);
	};
	part.recorder.onerror = (event) => {
		stopCapture(
			active.metadata.id,
			"error",
			(event as ErrorEvent).message || t("recordingErrorOccurred"),
		);
	};
	part.recorder.onstop = () => {
		void finalizeStoppedPart(active, part);
	};
	part.recorder.start(CAPTURE_CHUNK_TIMESLICE_MS);
	recordingHud?.updatePart(active.metadata.id, part.index);
}

function enqueueChunk(
	active: ActiveRecording,
	part: RecordingPart,
	blob: Blob,
): void {
	if (blob.size <= 0 || active.finishSent) {
		return;
	}
	if (
		blob.size > MAX_CAPTURE_CHUNK_BYTES ||
		part.queuedBytes + blob.size > MAX_QUEUED_WRITE_BYTES
	) {
		stopCapture(
			active.metadata.id,
			"write_failed",
			t("writeBackpressureStopped"),
		);
		return;
	}

	part.queuedBytes += blob.size;
	part.writeQueue = part.writeQueue
		.then(() => writeChunk(active, part, blob))
		.catch((error: unknown) => {
			setStopReason(
				active,
				"write_failed",
				getErrorMessage(error, t("recordingDataWriteFailed")),
			);
			stopPart(part, "finish");
		})
		.finally(() => {
			part.queuedBytes -= blob.size;
		});
}

async function writeChunk(
	active: ActiveRecording,
	part: RecordingPart,
	blob: Blob,
): Promise<void> {
	await part.writable.write(blob);
	part.sizeBytes += blob.size;
	part.chunkCount += 1;
	active.metadata = {
		...active.metadata,
		sizeBytes: active.metadata.sizeBytes + blob.size,
		elapsedMs: performance.now() - active.startedAt,
		chunkCount: active.metadata.chunkCount + 1,
		currentPartSizeBytes: part.sizeBytes,
	};
	recordingHud?.update(active.metadata.id, active.metadata.elapsedMs);
	postProgress(active);
	if (shouldSplitPart(part.sizeBytes) && !part.stopMode && !active.stopReason) {
		stopPart(part, "rollover", { requestData: true });
	}
}

function stopCapture(
	captureId: string,
	stopReason: StopReason,
	errorMessage?: string,
	resolutionChange?: ResolutionChange,
): void {
	const active = activeRecordings.get(captureId);
	if (!active || active.finishSent) {
		return;
	}
	window.clearInterval(active.resolutionTimer);
	if (resolutionChange) {
		active.metadata = {
			...active.metadata,
			resolutionChange,
		};
	}
	setStopReason(active, stopReason, errorMessage);
	recordingHud?.markStopping(captureId, performance.now() - active.startedAt);
	stopPart(active.part, "finish", { requestData: true });
	if (!active.finalizeTimer) {
		active.finalizeTimer = window.setTimeout(() => {
			active.finalizeTimer = undefined;
			if (!active.finishSent) {
				void finalizeStoppedPart(active, active.part);
			}
		}, FORCE_FINALIZE_TIMEOUT_MS);
	}
}

function rolloverForResolutionChange(
	active: ActiveRecording,
	change: ResolutionChange,
): void {
	if (active.part.stopMode || active.stopReason || active.finishSent) {
		return;
	}
	active.pendingResolutionChange = change;
	active.metadata = {
		...active.metadata,
		width: change.to.width,
		height: change.to.height,
	};
	stopPart(active.part, "rollover", { requestData: true });
}

function stopPart(
	part: RecordingPart,
	stopMode: NonNullable<RecordingPart["stopMode"]>,
	options: { requestData?: boolean } = {},
): void {
	if (part.recorder.state === "inactive") {
		return;
	}
	part.stopMode = stopMode;
	if (options.requestData) {
		part.recorder.requestData();
	}
	part.recorder.stop();
}

function stopAllRecordings(
	stopReason: StopReason,
	errorMessage?: string,
): void {
	for (const captureId of activeRecordings.keys()) {
		stopCapture(captureId, stopReason, errorMessage);
	}
}

async function finalizeStoppedPart(
	active: ActiveRecording,
	part: RecordingPart,
): Promise<void> {
	if (active.finishSent || active.part !== part) {
		return;
	}
	if (part.finalizing) {
		return;
	}
	part.finalizing = true;
	try {
		await part.writeQueue;
		if (isFatalStopReason(active.stopReason) || part.sizeBytes === 0) {
			await discardCurrentPart(active, part);
		} else {
			await saveCurrentPart(active, part);
		}
	} catch (error) {
		await discardCurrentPart(active, part);
		setStopReason(
			active,
			"write_failed",
			getErrorMessage(error, t("recordingFileFinalizeFailed")),
		);
	}

	if (part.stopMode === "rollover" && !active.stopReason) {
		const started = await startNextPart(active, part.index + 1);
		if (started) {
			return;
		}
	}
	await finishRecording(active);
}

async function startNextPart(
	active: ActiveRecording,
	index: number,
): Promise<boolean> {
	try {
		const nextPart = await createRecordingPart(
			active.directory,
			active.metadata,
			active.stream,
			index,
		);
		const pendingChange = active.pendingResolutionChange;
		active.part = nextPart;
		active.metadata = {
			...active.metadata,
			partCount: nextPart.index,
			currentPartSizeBytes: 0,
			resolutionChanges: pendingChange
				? [
						...(active.metadata.resolutionChanges ?? []),
						{ ...pendingChange, partIndex: nextPart.index },
					]
				: active.metadata.resolutionChanges,
		};
		active.pendingResolutionChange = undefined;
		postProgress(active);
		startPart(active);
		if (pendingChange) {
			recordingHud?.notify(
				active.metadata.id,
				t("resolutionRolloverHud", [
					formatResolution(pendingChange.from),
					formatResolution(pendingChange.to),
				]),
			);
		}
		return true;
	} catch (error) {
		setStopReason(
			active,
			"write_failed",
			getErrorMessage(error, t("nextRecordingFileCreateFailed")),
		);
		return false;
	}
}

async function saveCurrentPart(
	active: ActiveRecording,
	part: RecordingPart,
): Promise<void> {
	await part.writable.close();
	active.metadata = {
		...active.metadata,
		savedPartCount: (active.metadata.savedPartCount ?? 0) + 1,
	};
	postProgress(active);
}

async function discardCurrentPart(
	active: ActiveRecording,
	part: RecordingPart,
): Promise<void> {
	await part.writable.abort().catch(() => undefined);
	await removePartFile(active.directory, part.fileName);
	discardPartProgress(active, part);
}

function discardPartProgress(
	active: ActiveRecording,
	part: RecordingPart,
): void {
	active.metadata = {
		...active.metadata,
		sizeBytes: Math.max(0, active.metadata.sizeBytes - part.sizeBytes),
		chunkCount: Math.max(0, active.metadata.chunkCount - part.chunkCount),
		currentPartSizeBytes: 0,
		resolutionChanges: markResolutionChangeFileDiscarded(
			active.metadata.resolutionChanges,
			part.index,
		),
	};
}

async function finishRecording(active: ActiveRecording): Promise<void> {
	if (active.finishSent) {
		return;
	}
	active.finishSent = true;
	window.clearInterval(active.resolutionTimer);
	if (active.finalizeTimer) {
		window.clearTimeout(active.finalizeTimer);
		active.finalizeTimer = undefined;
	}
	stopStream(active.stream);
	const stopReason = active.stopReason;
	const hasSavedParts = (active.metadata.savedPartCount ?? 0) > 0;

	try {
		postCaptureStreamMessage(
			active.port,
			createCaptureFinishedMessage(active.metadata, {
				stopReason,
				errorMessage: active.errorMessage,
				elapsedMs: performance.now() - active.startedAt,
			}),
		);
		const hudResult = getHudResult(
			stopReason,
			active.errorMessage,
			hasSavedParts,
		);
		recordingHud?.finish(active.metadata.id, hudResult.message, hudResult.tone);
	} finally {
		activeRecordings.delete(active.metadata.id);
		active.port.disconnect();
	}
}

function postProgress(active: ActiveRecording): void {
	postCaptureStreamMessage(active.port, createProgressMessage(active.metadata));
}

function setStopReason(
	active: ActiveRecording,
	reason: StopReason,
	errorMessage?: string,
): void {
	const next = reduceStopReason(active, { stopReason: reason, errorMessage });
	active.stopReason = next.stopReason;
	active.errorMessage = next.errorMessage;
}

async function removePartFile(
	directory: FileSystemDirectoryHandle,
	fileName: string,
): Promise<void> {
	await directory.removeEntry(fileName).catch(() => undefined);
}

function createResolutionTimer(
	video: HTMLVideoElement,
	active: ActiveRecording,
): number {
	return window.setInterval(() => {
		const commands = evaluateRecordingTick(active.monitorState, {
			connected: isVideoConnected(video),
			current: getCurrentVideoResolution(video),
			recorded: {
				width: active.metadata.width,
				height: active.metadata.height,
			},
			continueOnResolutionChange: active.continueOnResolutionChange,
			recorderRecording: active.part.recorder.state === "recording",
			paused: video.paused,
			seeking: video.seeking,
			nowMs: performance.now(),
			lastDataAtMs: active.lastDataAt,
		});
		for (const command of commands) {
			if (command.type === "rollover") {
				rolloverForResolutionChange(active, command.change);
			} else if (command.reason === "resolution_changed") {
				stopCapture(
					active.metadata.id,
					"resolution_changed",
					undefined,
					command.change,
				);
			} else {
				stopCapture(active.metadata.id, command.reason);
			}
		}
	}, 500);
}

function getCurrentVideoResolution(video: HTMLVideoElement): VideoResolution {
	return {
		width: video.videoWidth || video.clientWidth || 0,
		height: video.videoHeight || video.clientHeight || 0,
	};
}

function listCapturableVideos(): VideoDescriptor[] {
	const videos = listVideos();
	if (window.showDirectoryPicker) {
		return videos;
	}
	return videos.map((video) => ({
		...video,
		canCapture: false,
		reason: t("directFolderSaveUnsupported"),
	}));
}

function createThumbnail(video: HTMLVideoElement): string | undefined {
	try {
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, video.videoWidth || video.clientWidth || 320);
		canvas.height = Math.max(1, video.videoHeight || video.clientHeight || 180);
		canvas
			.getContext("2d")
			?.drawImage(video, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/jpeg", 0.74);
	} catch {
		return undefined;
	}
}

function postCaptureStreamMessage(
	port: Browser.runtime.Port,
	message: CaptureStreamPortMessage,
): void {
	port.postMessage(message);
}

function stopStream(stream: MediaStream): void {
	for (const track of stream.getTracks()) {
		track.stop();
	}
}
