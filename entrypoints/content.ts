import { createCaptureMetadata } from "@/shared/capture-state";
import {
	isFilePickerAbortError,
	MP4_FILE_PICKER_TYPES,
} from "@/shared/file-system";
import { isExtensionMessage } from "@/shared/message";
import type {
	CaptureFinishedMessage,
	CaptureMetadata,
	CaptureStreamPortMessage,
	StopReason,
	VideoDescriptor,
} from "@/shared/types";
import {
	createVideoCaptureStream,
	describeVideo,
	findVideoFromPoint,
	formatDuration,
	getMp4MimeType,
	listVideos,
} from "@/shared/video";

type ActiveRecording = {
	metadata: CaptureMetadata;
	recorder: MediaRecorder;
	stream: MediaStream;
	writable: FileSystemWritableFileStream;
	port: Browser.runtime.Port;
	startedAt: number;
	resolutionTimer: number;
	writeQueue: Promise<void>;
	queuedBytes: number;
	finishSent: boolean;
	hud: RecordingHud;
	stopReason?: StopReason;
	errorMessage?: string;
};

type StartRecordingResult =
	| { ok: true }
	| { ok: false; cancelled?: boolean; reason?: string };

type VideoPicker = {
	start: () => void;
	destroy: () => void;
};

type RecordingHud = {
	update: (elapsedMs: number, stopping?: boolean) => void;
	finish: (message: string, tone: "success" | "warning" | "error") => void;
	destroy: () => void;
};

const CAPTURE_CHUNK_TIMESLICE_MS = 3000;
const MAX_CAPTURE_CHUNK_BYTES = 42 * 1024 * 1024;
const MAX_QUEUED_WRITE_BYTES = 128 * 1024 * 1024;
const activeRecordings = new Map<string, ActiveRecording>();

export default defineContentScript({
	matches: ["<all_urls>"],
	allFrames: false,
	runAt: "document_idle",
	main(ctx) {
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
			:host { all: initial; }
			.frame {
				position: fixed;
				box-sizing: border-box;
				border: 2px solid #1a73e8;
				background: rgba(26, 115, 232, 0.08);
				pointer-events: none;
			}
				.toolbar {
					position: fixed;
					display: flex;
					align-items: center;
					gap: 8px;
					max-width: calc(100vw - 16px);
					padding: 7px 8px;
				border-radius: 6px;
				background: #172033;
				color: #f8fbff;
				font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
				pointer-events: auto;
			}
			.instructions {
				position: fixed;
				top: 12px;
				left: 50%;
				transform: translateX(-50%);
				padding: 8px 12px;
				border-radius: 6px;
				background: #172033;
				color: #f8fbff;
				font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif;
				box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
				pointer-events: none;
			}
			.label { font-weight: 700; color: #9fd0ff; white-space: nowrap; }
			.meta { color: #d7e2f0; white-space: nowrap; }
				.message {
					max-width: 240px;
					color: #ffcc80;
				}
			button {
				border: 0;
				border-radius: 4px;
				padding: 5px 8px;
				font: inherit;
				font-weight: 700;
				cursor: pointer;
			}
			button:disabled { cursor: wait; opacity: 0.65; }
			.start { background: #8bd450; color: #132000; }
			.cancel { background: transparent; color: #d7e2f0; }
		</style>
		<div class="instructions" hidden>
			録画する動画にカーソルを合わせてください　<span>Escでキャンセル</span>
		</div>
		<div class="frame" hidden></div>
		<div class="toolbar" hidden>
			<span class="label">video</span>
			<span class="meta"></span>
			<span class="message" hidden></span>
				<button class="start" type="button">保存先を選択して録画開始</button>
				<button class="cancel" type="button">キャンセル</button>
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
	if (!window.showSaveFilePicker) {
		return {
			ok: false,
			reason: "このブラウザでは直接ファイル保存に対応していません。",
		};
	}

	const descriptor = describeVideo(video);
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
		storageMode: "direct-file",
		scope: "element",
	});

	let fileHandle: FileSystemFileHandle;
	try {
		fileHandle = await window.showSaveFilePicker({
			suggestedName: metadata.fileName,
			startIn: "downloads",
			types: MP4_FILE_PICKER_TYPES,
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

	let writable: FileSystemWritableFileStream | undefined;
	let recorder: MediaRecorder | undefined;
	try {
		writable = await fileHandle.createWritable();
		recorder = new MediaRecorder(stream, { mimeType });
	} catch (error) {
		stopStream(stream);
		await writable?.abort();
		return {
			ok: false,
			reason: getErrorMessage(error, "MediaRecorder の開始に失敗しました。"),
		};
	}

	const port = browser.runtime.connect({ name: "capture-stream" });
	const startedAt = performance.now();
	const active: ActiveRecording = {
		metadata,
		recorder,
		stream,
		writable,
		port,
		startedAt,
		resolutionTimer: 0,
		writeQueue: Promise.resolve(),
		queuedBytes: 0,
		finishSent: false,
		hud: createRecordingHud(metadata.id),
	};
	activeRecordings.set(metadata.id, active);
	bindRecordingEvents(active, video);
	try {
		recorder.start(CAPTURE_CHUNK_TIMESLICE_MS);
	} catch (error) {
		window.clearInterval(active.resolutionTimer);
		activeRecordings.delete(metadata.id);
		port.disconnect();
		stopStream(stream);
		await writable.abort();
		active.hud.destroy();
		return {
			ok: false,
			reason: getErrorMessage(error, "MediaRecorder の開始に失敗しました。"),
		};
	}
	postCaptureStreamMessage(port, { type: "CAPTURE_STARTED", metadata });
	active.hud.update(0);
	return { ok: true };
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
	active.recorder.ondataavailable = (event) => {
		enqueueChunk(active, event.data);
	};
	active.recorder.onerror = (event) => {
		stopCapture(
			captureId,
			"error",
			(event as ErrorEvent).message || "録画中にエラーが発生しました。",
		);
	};
	active.recorder.onstop = () => {
		void finishRecording(active);
	};
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

function enqueueChunk(active: ActiveRecording, blob: Blob): void {
	if (blob.size <= 0 || active.finishSent) {
		return;
	}
	if (
		blob.size > MAX_CAPTURE_CHUNK_BYTES ||
		active.queuedBytes + blob.size > MAX_QUEUED_WRITE_BYTES
	) {
		stopCapture(
			active.metadata.id,
			"write_failed",
			"ファイル書き込みが録画速度に追いつかないため停止しました。",
		);
		return;
	}

	active.queuedBytes += blob.size;
	active.writeQueue = active.writeQueue
		.then(() => writeChunk(active, blob))
		.catch((error: unknown) => {
			active.stopReason = "write_failed";
			active.errorMessage = getErrorMessage(
				error,
				"録画データの書き込みに失敗しました。",
			);
			if (active.recorder.state !== "inactive") {
				active.recorder.stop();
			}
		})
		.finally(() => {
			active.queuedBytes -= blob.size;
		});
}

async function writeChunk(active: ActiveRecording, blob: Blob): Promise<void> {
	await active.writable.write(blob);
	active.metadata = {
		...active.metadata,
		sizeBytes: active.metadata.sizeBytes + blob.size,
		elapsedMs: performance.now() - active.startedAt,
		chunkCount: active.metadata.chunkCount + 1,
	};
	active.hud.update(active.metadata.elapsedMs);
	postCaptureStreamMessage(active.port, {
		type: "CAPTURE_PROGRESS",
		captureId: active.metadata.id,
		sizeBytes: active.metadata.sizeBytes,
		elapsedMs: active.metadata.elapsedMs,
		chunkCount: active.metadata.chunkCount,
	});
}

function stopCapture(
	captureId: string,
	stopReason: StopReason,
	errorMessage?: string,
): void {
	const active = activeRecordings.get(captureId);
	if (!active || active.finishSent) {
		return;
	}
	window.clearInterval(active.resolutionTimer);
	active.stopReason = stopReason;
	active.errorMessage = errorMessage;
	active.hud.update(performance.now() - active.startedAt, true);
	if (active.recorder.state !== "inactive") {
		active.recorder.requestData();
		active.recorder.stop();
	}
}

function stopAllRecordings(
	stopReason: StopReason,
	errorMessage?: string,
): void {
	for (const captureId of activeRecordings.keys()) {
		stopCapture(captureId, stopReason, errorMessage);
	}
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

	try {
		await active.writeQueue;
		if (isFatal) {
			await active.writable.abort();
		} else {
			await active.writable.close();
		}
		postCaptureStreamMessage(active.port, {
			type: "CAPTURE_FINISHED",
			captureId: active.metadata.id,
			status: getFinishedStatus(stopReason),
			fileStatus: isFatal ? "failed" : "saved",
			stopReason: stopReason === "user" ? undefined : stopReason,
			errorMessage: active.errorMessage,
			elapsedMs: performance.now() - active.startedAt,
		});
		const hudResult = getHudResult(stopReason, active.errorMessage);
		active.hud.finish(hudResult.message, hudResult.tone);
	} catch (error) {
		await active.writable.abort().catch(() => undefined);
		postCaptureStreamMessage(active.port, {
			type: "CAPTURE_FINISHED",
			captureId: active.metadata.id,
			status: "error",
			fileStatus: "failed",
			stopReason: "write_failed",
			errorMessage: getErrorMessage(
				error,
				"録画ファイルの確定に失敗しました。",
			),
			elapsedMs: performance.now() - active.startedAt,
		});
		active.hud.finish(
			getErrorMessage(error, "録画ファイルを保存できませんでした。"),
			"error",
		);
	} finally {
		activeRecordings.delete(active.metadata.id);
		active.port.disconnect();
	}
}

function createResolutionTimer(
	video: HTMLVideoElement,
	metadata: CaptureMetadata,
): number {
	return window.setInterval(() => {
		if (!document.contains(video)) {
			stopCapture(metadata.id, "video_removed");
			return;
		}
		if (
			(video.videoWidth || video.clientWidth) !== metadata.width ||
			(video.videoHeight || video.clientHeight) !== metadata.height
		) {
			stopCapture(metadata.id, "resolution_changed");
		}
	}, 500);
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
): {
	message: string;
	tone: "success" | "warning" | "error";
} {
	if (isFatalStopReason(reason)) {
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

function createRecordingHud(captureId: string): RecordingHud {
	const host = document.createElement("div");
	host.style.position = "fixed";
	host.style.right = "16px";
	host.style.bottom = "16px";
	host.style.zIndex = "2147483647";
	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>
			:host { all: initial; }
			.panel {
				box-sizing: border-box;
				width: min(340px, calc(100vw - 32px));
				padding: 12px;
				border: 1px solid rgba(255, 255, 255, 0.14);
				border-radius: 10px;
				background: #172033;
				color: #f8fbff;
				font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
				box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
				pointer-events: auto;
			}
			.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
			.title { font-weight: 750; }
			.dot { color: #ff6262; }
			.detail { margin: 5px 0 0; color: #cbd7e7; }
			.actions { display: flex; gap: 8px; margin-top: 10px; }
			button {
				border: 0;
				border-radius: 5px;
				padding: 6px 9px;
				font: inherit;
				font-weight: 700;
				cursor: pointer;
			}
			.open { background: #d9e8fb; color: #172033; }
			.stop { background: #ffcc80; color: #2b1b00; }
			button:disabled { cursor: wait; opacity: 0.65; }
			.success { border-color: #55c98f; }
			.warning { border-color: #ffcc80; }
			.error { border-color: #ff7575; }
		</style>
		<div class="panel">
			<div class="row">
				<span class="title"><span class="dot">●</span> 録画中</span>
				<span class="time">0:00</span>
			</div>
			<p class="detail">選択した保存先へ記録中です。</p>
			<div class="actions">
				<button class="open" type="button">状況を開く</button>
				<button class="stop" type="button">停止して保存</button>
			</div>
		</div>
	`;
	const panel = shadow.querySelector<HTMLElement>(".panel");
	const title = shadow.querySelector<HTMLElement>(".title");
	const time = shadow.querySelector<HTMLElement>(".time");
	const detail = shadow.querySelector<HTMLElement>(".detail");
	const actions = shadow.querySelector<HTMLElement>(".actions");
	const openButton = shadow.querySelector<HTMLButtonElement>(".open");
	const stopButton = shadow.querySelector<HTMLButtonElement>(".stop");
	document.documentElement.append(host);

	openButton?.addEventListener("click", () => {
		void browser.runtime.sendMessage({ type: "OPEN_CAPTURES", captureId });
	});
	stopButton?.addEventListener("click", () => {
		stopCapture(captureId, "user");
	});

	let removeTimer: number | undefined;
	return {
		update(elapsedMs, stopping = false) {
			if (time) {
				time.textContent = formatDuration(elapsedMs);
			}
			if (stopping && title && detail && stopButton) {
				title.textContent = "保存して終了中…";
				detail.textContent = "MP4ファイルを確定しています。";
				stopButton.disabled = true;
			}
		},
		finish(message, tone) {
			panel?.classList.add(tone);
			if (title) {
				title.textContent =
					tone === "error" ? "保存できませんでした" : "録画を終了しました";
			}
			if (detail) {
				detail.textContent = message;
			}
			if (time) {
				time.textContent = "";
			}
			actions?.remove();
			removeTimer = window.setTimeout(() => host.remove(), 8000);
		},
		destroy() {
			if (removeTimer) {
				window.clearTimeout(removeTimer);
			}
			host.remove();
		},
	};
}

function listCapturableVideos(): VideoDescriptor[] {
	const videos = listVideos();
	if (window.showSaveFilePicker) {
		return videos;
	}
	return videos.map((video) => ({
		...video,
		canCapture: false,
		reason: "このブラウザでは直接ファイル保存に対応していません",
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
