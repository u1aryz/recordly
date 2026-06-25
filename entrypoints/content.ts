import { createCaptureMetadata } from "@/shared/capture-state";
import {
	createPartFileName,
	isFilePickerAbortError,
	shouldSplitPart,
} from "@/shared/file-system";
import { INJECTED_UI_THEME_CSS } from "@/shared/injected-ui-theme";
import { isExtensionMessage } from "@/shared/message";
import {
	createRecordingHudManager,
	type RecordingHudManager,
} from "@/shared/recording-hud";
import type {
	CaptureFinishedMessage,
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
	findVideoFromPoint,
	getMp4MimeType,
	isVideoConnected,
	listVideos,
} from "@/shared/video";

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
};

type StartRecordingResult =
	| { ok: true }
	| { ok: false; cancelled?: boolean; reason?: string };

type VideoPicker = {
	start: () => void;
	destroy: () => void;
};

const CAPTURE_CHUNK_TIMESLICE_MS = 3000;
const MAX_CAPTURE_CHUNK_BYTES = 42 * 1024 * 1024;
const MAX_QUEUED_WRITE_BYTES = 128 * 1024 * 1024;
const VIDEO_REMOVED_GRACE_TICKS = 4;
const activeRecordings = new Map<string, ActiveRecording>();
let recordingHud: RecordingHudManager | undefined;

export default defineContentScript({
	matches: ["<all_urls>"],
	allFrames: false,
	runAt: "document_idle",
	main(ctx) {
		recordingHud = createRecordingHudManager({
			onOpen(captureId) {
				void browser.runtime.sendMessage({ type: "OPEN_CAPTURES", captureId });
			},
			onStop(captureId) {
				stopCapture(captureId, "user");
			},
		});
		const picker = createVideoPicker();

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
			stopAllRecordings(
				"error",
				"拡張機能が更新されたため録画を終了しました。",
			);
			recordingHud?.destroy();
			recordingHud = undefined;
		});
	},
});

function createVideoPicker(): VideoPicker {
	let picking = false;
	let currentVideo: HTMLVideoElement | null = null;
	const host = document.createElement("div");
	host.style.position = "fixed";
	host.style.inset = "0";
	host.style.pointerEvents = "none";
	host.style.zIndex = "2147483647";
	host.style.display = "none";
	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>
			${INJECTED_UI_THEME_CSS}
			.frame {
				position: fixed;
				border: 2px solid var(--base-100);
				background: color-mix(in oklch, var(--primary) 10%, transparent);
				box-shadow:
					0 0 0 1px color-mix(in oklch, var(--base-100) 65%, transparent),
					0 0 0 4px color-mix(in oklch, var(--primary) 18%, transparent);
				pointer-events: none;
			}
			.toolbar {
				position: fixed;
				display: flex;
				flex-direction: column;
				max-width: calc(100vw - 16px);
				overflow: hidden;
				border: 1px solid var(--base-300);
				border-radius: 8px;
				background: var(--base-100);
				color: var(--base-content);
				font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				box-shadow: 0 16px 40px color-mix(in oklch, black 42%, transparent);
				pointer-events: auto;
			}
			.toolbar-main {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 8px;
			}
			.instructions {
				position: fixed;
				top: 12px;
				left: 50%;
				transform: translateX(-50%);
				max-width: calc(100vw - 24px);
				padding: 9px 13px;
				border: 1px solid var(--base-300);
				border-radius: 8px;
				background: var(--base-100);
				color: var(--base-content);
				font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif;
				box-shadow: 0 12px 32px color-mix(in oklch, black 38%, transparent);
				pointer-events: none;
				white-space: nowrap;
			}
			.instructions span { color: color-mix(in oklch, var(--base-content) 62%, transparent); }
			.label {
				padding: 3px 6px;
				border: 1px solid color-mix(in oklch, var(--primary) 45%, transparent);
				border-radius: 4px;
				background: color-mix(in oklch, var(--primary) 12%, transparent);
				color: var(--primary);
				font-weight: 700;
				letter-spacing: 0.04em;
				white-space: nowrap;
			}
			.meta {
				color: color-mix(in oklch, var(--base-content) 72%, transparent);
				white-space: nowrap;
			}
			.message {
				padding: 8px 10px;
				border-top: 1px solid var(--base-300);
				background: var(--base-200);
				color: var(--warning);
			}
			button {
				min-height: 30px;
				border: 1px solid transparent;
				border-radius: 8px;
				padding: 5px 10px;
				font: inherit;
				font-weight: 700;
				cursor: pointer;
			}
			button:disabled { cursor: wait; opacity: 0.65; }
			button:focus-visible {
				outline: 2px solid var(--primary);
				outline-offset: 2px;
			}
			.start {
				background: var(--primary);
				color: var(--primary-content);
			}
			.start:hover:not(:disabled) {
				background: color-mix(in oklch, var(--primary) 88%, white);
			}
			.cancel {
				border-color: var(--base-300);
				background: var(--base-200);
				color: color-mix(in oklch, var(--base-content) 78%, transparent);
			}
			.cancel:hover {
				background: var(--base-300);
				color: var(--base-content);
			}
			@media (max-width: 560px) {
				.toolbar-main { flex-wrap: wrap; }
				.meta {
					order: 3;
					width: 100%;
				}
				.instructions {
					text-align: center;
					white-space: normal;
				}
			}
		</style>
		<div class="instructions" hidden>
			${t("pickerInstructions")}　<span>${t("pickerCancelHint")}</span>
		</div>
		<div class="frame" hidden></div>
		<div class="toolbar" hidden>
			<div class="toolbar-main">
				<span class="label">video</span>
				<span class="meta"></span>
				<button class="start" type="button">${t("chooseFolderAndRecord")}</button>
				<button class="cancel" type="button">${t("cancel")}</button>
			</div>
			<div class="message" hidden></div>
		</div>
	`;

	const instructions = shadow.querySelector<HTMLElement>(".instructions");
	const frame = shadow.querySelector<HTMLElement>(".frame");
	const toolbar = shadow.querySelector<HTMLElement>(".toolbar");
	const meta = shadow.querySelector<HTMLElement>(".meta");
	const message = shadow.querySelector<HTMLElement>(".message");
	const startButton = shadow.querySelector<HTMLButtonElement>(".start");
	const cancelButton = shadow.querySelector<HTMLButtonElement>(".cancel");

	function mount(): void {
		if (!host.isConnected) {
			document.documentElement.append(host);
		}
		host.style.display = "block";
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", refreshOverlay, true);
		window.addEventListener("resize", refreshOverlay, true);
	}

	function start(): void {
		if (picking) {
			return;
		}
		picking = true;
		currentVideo = null;
		mount();
		window.addEventListener("pointermove", onPointerMove, true);
		if (instructions) {
			instructions.hidden = false;
		}
		refreshOverlay();
	}

	function stop(): void {
		picking = false;
		currentVideo = null;
		host.style.display = "none";
		instructions?.setAttribute("hidden", "");
		frame?.setAttribute("hidden", "");
		toolbar?.setAttribute("hidden", "");
		message?.setAttribute("hidden", "");
		window.removeEventListener("pointermove", onPointerMove, true);
		window.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", refreshOverlay, true);
		window.removeEventListener("resize", refreshOverlay, true);
		host.remove();
	}

	function onPointerMove(event: PointerEvent): void {
		if (!picking) {
			return;
		}
		if (event.composedPath().includes(host)) {
			return;
		}
		const video = findVideoFromPoint(event.clientX, event.clientY);
		if (video !== currentVideo) {
			currentVideo = video;
			refreshOverlay();
		}
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			stop();
		}
	}

	function refreshOverlay(): void {
		if (!currentVideo || !frame || !toolbar || !meta) {
			frame?.setAttribute("hidden", "");
			toolbar?.setAttribute("hidden", "");
			return;
		}
		if (!document.contains(currentVideo)) {
			stop();
			return;
		}
		const rect = currentVideo.getBoundingClientRect();
		const info = describeVideo(currentVideo);
		frame.hidden = false;
		frame.style.left = `${rect.left}px`;
		frame.style.top = `${rect.top}px`;
		frame.style.width = `${rect.width}px`;
		frame.style.height = `${rect.height}px`;
		toolbar.hidden = false;
		meta.textContent = `${info.width || "?"} x ${info.height || "?"} / ${
			info.paused ? "一時停止" : "再生中"
		} / ${info.muted ? "ミュート" : "音声あり"}`;
		const toolbarWidth = toolbar.offsetWidth;
		const toolbarHeight = toolbar.offsetHeight;
		toolbar.style.left = `${Math.max(
			8,
			Math.min(rect.left, window.innerWidth - toolbarWidth - 8),
		)}px`;
		toolbar.style.top = `${Math.max(8, rect.top - toolbarHeight - 8)}px`;
	}

	startButton?.addEventListener("click", async () => {
		if (!currentVideo || !startButton || !message) {
			return;
		}
		startButton.disabled = true;
		message.hidden = true;
		const result = await startRecording(currentVideo);
		startButton.disabled = false;
		if (result.ok) {
			stop();
			return;
		}
		if (result.cancelled) {
			return;
		}
		message.textContent = result.reason ?? "録画を開始できませんでした。";
		message.hidden = false;
	});
	cancelButton?.addEventListener("click", stop);

	return { start, destroy: stop };
}

async function startRecording(
	video: HTMLVideoElement,
): Promise<StartRecordingResult> {
	if (!window.showDirectoryPicker) {
		return {
			ok: false,
			reason: "このブラウザではフォルダへの直接保存に対応していません。",
		};
	}

	const descriptor = describeVideo(video);
	const existing = findActiveRecordingByVideoId(descriptor.id);
	if (existing) {
		recordingHud?.highlight(existing.metadata.id);
		return {
			ok: false,
			reason: "この動画はすでに録画中です。",
		};
	}
	const mimeType = getMp4MimeType();
	if (!mimeType) {
		return {
			ok: false,
			reason: "このブラウザは MediaRecorder の MP4 出力に対応していません。",
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
			reason: getErrorMessage(error, "保存先を選べませんでした。"),
		};
	}

	const { stream, errorMessage } = createVideoCaptureStream(video);
	if (!stream) {
		return {
			ok: false,
			reason: errorMessage ?? "video.captureStream() が使えません。",
		};
	}

	let part: RecordingPart | undefined;
	try {
		part = await createRecordingPart(directory, metadata, stream, 1);
	} catch (error) {
		stopStream(stream);
		return {
			ok: false,
			reason: getErrorMessage(error, "MediaRecorder の開始に失敗しました。"),
		};
	}

	const port = browser.runtime.connect({ name: "capture-stream" });
	const startedAt = performance.now();
	const active: ActiveRecording = {
		metadata,
		stream,
		directory,
		part,
		port,
		startedAt,
		resolutionTimer: 0,
		finishSent: false,
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
			reason: getErrorMessage(error, "MediaRecorder の開始に失敗しました。"),
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
			stopCapture(captureId, "error", "録画状態の接続が切断されました。");
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
	active.resolutionTimer = createResolutionTimer(video, active.metadata);
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
	part.recorder.ondataavailable = (event) => {
		enqueueChunk(active, part, event.data);
	};
	part.recorder.onerror = (event) => {
		stopCapture(
			active.metadata.id,
			"error",
			(event as ErrorEvent).message || "録画中にエラーが発生しました。",
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
			"ファイル書き込みが録画速度に追いつかないため停止しました。",
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
				getErrorMessage(error, "録画データの書き込みに失敗しました。"),
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
	try {
		await part.writeQueue;
		if (isFatalStopReason(active.stopReason)) {
			await discardCurrentPart(active, part);
		} else {
			await saveCurrentPart(active, part);
		}
	} catch (error) {
		await discardCurrentPart(active, part);
		setStopReason(
			active,
			"write_failed",
			getErrorMessage(error, "録画ファイルの確定に失敗しました。"),
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
		active.part = nextPart;
		active.metadata = {
			...active.metadata,
			partCount: nextPart.index,
			currentPartSizeBytes: 0,
		};
		postProgress(active);
		startPart(active);
		return true;
	} catch (error) {
		setStopReason(
			active,
			"write_failed",
			getErrorMessage(error, "次の録画ファイルを作成できませんでした。"),
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
	};
}

async function finishRecording(active: ActiveRecording): Promise<void> {
	if (active.finishSent) {
		return;
	}
	active.finishSent = true;
	window.clearInterval(active.resolutionTimer);
	stopStream(active.stream);
	const stopReason = active.stopReason;
	const isFatal = isFatalStopReason(stopReason);
	const hasSavedParts = (active.metadata.savedPartCount ?? 0) > 0;

	try {
		postCaptureStreamMessage(active.port, {
			type: "CAPTURE_FINISHED",
			captureId: active.metadata.id,
			status: getFinalStatus(stopReason, hasSavedParts),
			fileStatus: isFatal && !hasSavedParts ? "failed" : "saved",
			stopReason: stopReason === "user" ? undefined : stopReason,
			resolutionChange: active.metadata.resolutionChange,
			errorMessage: active.errorMessage,
			elapsedMs: performance.now() - active.startedAt,
			sizeBytes: active.metadata.sizeBytes,
			chunkCount: active.metadata.chunkCount,
			partCount: active.metadata.partCount ?? 1,
			savedPartCount: active.metadata.savedPartCount ?? 0,
			currentPartSizeBytes: active.metadata.currentPartSizeBytes ?? 0,
		});
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

function getFinalStatus(
	reason: StopReason | undefined,
	hasSavedParts: boolean,
): CaptureFinishedMessage["status"] {
	if (isFatalStopReason(reason) && hasSavedParts) {
		return "stopped";
	}
	return getFinishedStatus(reason);
}

function postProgress(active: ActiveRecording): void {
	postCaptureStreamMessage(active.port, createProgressMessage(active));
}

function createProgressMessage(
	active: ActiveRecording,
): CaptureStreamPortMessage {
	return {
		type: "CAPTURE_PROGRESS",
		captureId: active.metadata.id,
		sizeBytes: active.metadata.sizeBytes,
		elapsedMs: active.metadata.elapsedMs,
		chunkCount: active.metadata.chunkCount,
		partCount: active.metadata.partCount ?? 1,
		savedPartCount: active.metadata.savedPartCount ?? 0,
		currentPartSizeBytes: active.metadata.currentPartSizeBytes ?? 0,
	};
}

function setStopReason(
	active: ActiveRecording,
	reason: StopReason,
	errorMessage?: string,
): void {
	if (!active.stopReason || isFatalStopReason(reason)) {
		active.stopReason = reason;
		active.errorMessage = errorMessage;
	}
}

async function removePartFile(
	directory: FileSystemDirectoryHandle,
	fileName: string,
): Promise<void> {
	await directory.removeEntry(fileName).catch(() => undefined);
}

function createResolutionTimer(
	video: HTMLVideoElement,
	metadata: CaptureMetadata,
): number {
	let disconnectedTicks = 0;
	return window.setInterval(() => {
		if (!isVideoConnected(video)) {
			disconnectedTicks += 1;
			if (disconnectedTicks < VIDEO_REMOVED_GRACE_TICKS) {
				return;
			}
			stopCapture(metadata.id, "video_removed");
			return;
		}
		disconnectedTicks = 0;
		const currentResolution = getCurrentVideoResolution(video);
		if (hasResolutionChanged(metadata, currentResolution)) {
			stopCapture(metadata.id, "resolution_changed", undefined, {
				from: {
					width: metadata.width,
					height: metadata.height,
				},
				to: currentResolution,
			});
		}
	}, 500);
}

function getCurrentVideoResolution(video: HTMLVideoElement): VideoResolution {
	return {
		width: video.videoWidth || video.clientWidth || 0,
		height: video.videoHeight || video.clientHeight || 0,
	};
}

function hasResolutionChanged(
	metadata: CaptureMetadata,
	resolution: VideoResolution,
): boolean {
	return (
		resolution.width !== metadata.width || resolution.height !== metadata.height
	);
}

function getFinishedStatus(
	reason?: StopReason,
): CaptureFinishedMessage["status"] {
	if (reason === "user" || reason === "video_ended" || reason == null) {
		return "complete";
	}
	if (isFatalStopReason(reason)) {
		return "error";
	}
	return "stopped";
}

function isFatalStopReason(reason?: StopReason): boolean {
	return (
		reason === "error" || reason === "unsupported" || reason === "write_failed"
	);
}

function getCompletionMessage(reason?: StopReason): string {
	switch (reason) {
		case "video_ended":
			return "動画の再生終了に合わせて停止し、MP4を保存しました。";
		case "video_removed":
			return "対象動画がページからなくなったため自動停止しました。停止までの内容は保存済みです。";
		case "resolution_changed":
			return "動画の解像度が変わったため自動停止しました。停止までの内容は保存済みです。";
		case "source_closed":
			return "録画元が閉じられたため自動停止しました。停止までの内容は保存済みです。";
		default:
			return "録画を停止し、MP4を保存しました。";
	}
}

function getHudResult(
	reason?: StopReason,
	errorMessage?: string,
	hasSavedParts = false,
): {
	message: string;
	tone: "success" | "warning" | "error";
} {
	if (isFatalStopReason(reason)) {
		if (hasSavedParts) {
			return {
				message: errorMessage ?? t("savedPartsAfterError"),
				tone: "warning",
			};
		}
		return {
			message: errorMessage ?? "録画ファイルを保存できませんでした。",
			tone: "error",
		};
	}
	if (reason && reason !== "user") {
		return { message: getCompletionMessage(reason), tone: "warning" };
	}
	return { message: getCompletionMessage(reason), tone: "success" };
}

function listCapturableVideos(): VideoDescriptor[] {
	const videos = listVideos();
	if (window.showDirectoryPicker) {
		return videos;
	}
	return videos.map((video) => ({
		...video,
		canCapture: false,
		reason: "このブラウザではフォルダへの直接保存に対応していません",
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

function getErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return fallback;
}
