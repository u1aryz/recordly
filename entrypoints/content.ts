import { arrayBufferToBase64 } from "@/shared/binary";
import { createCaptureMetadata } from "@/shared/capture-state";
import type { CaptureMetadata, StopReason } from "@/shared/types";
import {
	createVideoCaptureStream,
	describeVideo,
	findVideoFromPoint,
	getMp4MimeType,
	listVideos,
} from "@/shared/video";

type ActiveRecording = {
	metadata: CaptureMetadata;
	recorder: MediaRecorder;
	startedAt: number;
	width: number;
	height: number;
	resolutionTimer: number;
	stopReason?: StopReason;
	errorMessage?: string;
	finishSent: boolean;
	pendingChunks: Promise<unknown>[];
};

const activeRecordings = new Map<string, ActiveRecording>();

export default defineContentScript({
	matches: ["<all_urls>"],
	allFrames: false,
	runAt: "document_idle",
	main(ctx) {
		const picker = createVideoPicker();

		browser.runtime.onMessage.addListener((message: unknown) => {
			if (!message || typeof message !== "object") {
				return undefined;
			}
			const type = (message as { type?: string }).type;
			if (type === "LIST_VIDEOS") {
				return Promise.resolve({ videos: listVideos() });
			}
			if (type === "START_PICKER") {
				picker.start();
				return Promise.resolve({ ok: true });
			}
			if (type === "START_CAPTURE") {
				return startCaptureById((message as { videoId: string }).videoId);
			}
			if (type === "STOP_CAPTURE") {
				stopCapture((message as { captureId: string }).captureId, "user");
				return Promise.resolve({ ok: true });
			}
			return undefined;
		});

		ctx.onInvalidated(() => {
			picker.destroy();
			for (const captureId of activeRecordings.keys()) {
				stopCapture(captureId, "error");
			}
		});
	},
});

function createVideoPicker() {
	let enabled = false;
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
				max-width: min(520px, calc(100vw - 24px));
				padding: 7px 8px;
				border-radius: 6px;
				background: #172033;
				color: #f8fbff;
				font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
				pointer-events: auto;
			}
			.label { font-weight: 700; color: #9fd0ff; white-space: nowrap; }
			.meta { color: #d7e2f0; white-space: nowrap; }
			button {
				border: 0;
				border-radius: 4px;
				padding: 5px 8px;
				font: inherit;
				font-weight: 700;
				cursor: pointer;
			}
			.start { background: #8bd450; color: #132000; }
			.cancel { background: transparent; color: #d7e2f0; }
		</style>
		<div class="frame" hidden></div>
		<div class="toolbar" hidden>
			<span class="label">video</span>
			<span class="meta"></span>
			<button class="start" type="button">キャプチャ開始</button>
			<button class="cancel" type="button">キャンセル</button>
		</div>
	`;

	const frame = shadow.querySelector<HTMLElement>(".frame");
	const toolbar = shadow.querySelector<HTMLElement>(".toolbar");
	const meta = shadow.querySelector<HTMLElement>(".meta");
	const startButton = shadow.querySelector<HTMLButtonElement>(".start");
	const cancelButton = shadow.querySelector<HTMLButtonElement>(".cancel");

	function start() {
		if (enabled) {
			return;
		}
		enabled = true;
		currentVideo = null;
		document.documentElement.append(host);
		host.style.display = "block";
		window.addEventListener("pointermove", onPointerMove, true);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", refreshOverlay, true);
	}

	function stop() {
		enabled = false;
		currentVideo = null;
		host.style.display = "none";
		frame?.setAttribute("hidden", "");
		toolbar?.setAttribute("hidden", "");
		window.removeEventListener("pointermove", onPointerMove, true);
		window.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", refreshOverlay, true);
		host.remove();
	}

	function destroy() {
		stop();
	}

	function onPointerMove(event: PointerEvent) {
		if (!enabled) {
			return;
		}
		const video = findVideoFromPoint(event.clientX, event.clientY);
		if (video !== currentVideo) {
			currentVideo = video;
			refreshOverlay();
		}
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			stop();
		}
	}

	function refreshOverlay() {
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
		toolbar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 520))}px`;
		toolbar.style.top = `${Math.max(8, rect.top - 42)}px`;
		meta.textContent = `${info.width || "?"} x ${info.height || "?"} / ${
			info.paused ? "一時停止" : "再生中"
		} / ${info.muted ? "ミュート" : "音声あり"}`;
	}

	startButton?.addEventListener("click", async () => {
		if (!currentVideo) {
			return;
		}
		const videoId = describeVideo(currentVideo).id;
		stop();
		await startCaptureById(videoId);
	});
	cancelButton?.addEventListener("click", stop);

	return { start, destroy };
}

async function startCaptureById(
	videoId: string,
): Promise<{ ok: boolean; reason?: string }> {
	const video = Array.from(document.querySelectorAll("video")).find(
		(candidate) => describeVideo(candidate).id === videoId,
	);
	if (!video) {
		return { ok: false, reason: "対象の video が見つかりません" };
	}

	const descriptor = describeVideo(video);
	const mimeType = getMp4MimeType();
	if (!mimeType) {
		const errorMessage =
			"このブラウザは MediaRecorder の MP4 出力に対応していません。";
		const metadata = createFailedCaptureMetadata(
			videoId,
			descriptor,
			"video/mp4",
		);
		await finishUnsupportedCapture(metadata, errorMessage);
		return { ok: false, reason: errorMessage };
	}

	const metadata = createCaptureMetadata({
		videoId,
		tabId: 0,
		pageUrl: location.href,
		title: descriptor.title,
		mimeType,
		width: descriptor.width,
		height: descriptor.height,
		thumbnailDataUrl: createThumbnail(video),
	});
	const { stream, errorMessage } = createVideoCaptureStream(video);
	if (!stream) {
		await finishUnsupportedCapture(
			metadata,
			errorMessage ?? "video.captureStream() が使えません。",
		);
		return { ok: false, reason: errorMessage };
	}

	let recorder: MediaRecorder;
	try {
		recorder = new MediaRecorder(stream, { mimeType });
	} catch (error) {
		stopStream(stream);
		const recorderErrorMessage = getRecorderErrorMessage(error);
		await finishUnsupportedCapture(metadata, recorderErrorMessage);
		return { ok: false, reason: recorderErrorMessage };
	}
	const startedAt = performance.now();
	recorder.ondataavailable = (event) => {
		if (event.data.size <= 0) {
			return;
		}
		const active = activeRecordings.get(metadata.id);
		const pending = event.data.arrayBuffer().then((chunk) => {
			const chunkBase64 = arrayBufferToBase64(chunk);
			return browser.runtime.sendMessage({
				type: "CAPTURE_CHUNK",
				captureId: metadata.id,
				chunkBase64,
				size: event.data.size,
				elapsedMs: performance.now() - startedAt,
			});
		});
		active?.pendingChunks.push(pending);
		void pending;
	};
	recorder.onerror = (event) =>
		stopCapture(metadata.id, "error", (event as ErrorEvent).message);
	recorder.onstop = () => {
		stopStream(stream);
		const active = activeRecordings.get(metadata.id);
		if (!active || active.finishSent) {
			return;
		}
		active.finishSent = true;
		void Promise.allSettled(active.pendingChunks).then(() =>
			browser.runtime.sendMessage({
				type: "CAPTURE_FINISHED",
				captureId: metadata.id,
				status: getFinishedStatus(active.stopReason),
				stopReason: active.stopReason ?? "user",
				errorMessage: active.errorMessage,
				elapsedMs: performance.now() - active.startedAt,
			}),
		);
		activeRecordings.delete(metadata.id);
	};

	const resolutionTimer = window.setInterval(() => {
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

	activeRecordings.set(metadata.id, {
		metadata,
		recorder,
		startedAt,
		width: metadata.width,
		height: metadata.height,
		resolutionTimer,
		finishSent: false,
		pendingChunks: [],
	});
	await browser.runtime.sendMessage({ type: "CAPTURE_STARTED", metadata });
	try {
		recorder.start(1000);
	} catch (error) {
		stopStream(stream);
		activeRecordings.delete(metadata.id);
		window.clearInterval(resolutionTimer);
		const recorderErrorMessage = getRecorderErrorMessage(error);
		await browser.runtime.sendMessage({
			type: "CAPTURE_FINISHED",
			captureId: metadata.id,
			status: "error",
			stopReason: "unsupported",
			errorMessage: recorderErrorMessage,
			elapsedMs: performance.now() - startedAt,
		});
		return { ok: false, reason: recorderErrorMessage };
	}
	return { ok: true };
}

function stopCapture(
	captureId: string,
	reason: StopReason,
	errorMessage?: string,
) {
	const active = activeRecordings.get(captureId);
	if (!active) {
		return;
	}
	window.clearInterval(active.resolutionTimer);
	active.stopReason = reason;
	active.errorMessage = errorMessage;
	if (active.recorder.state !== "inactive") {
		active.recorder.requestData();
		active.recorder.stop();
		return;
	}
	if (!active.finishSent) {
		active.finishSent = true;
		activeRecordings.delete(captureId);
		void browser.runtime.sendMessage({
			type: "CAPTURE_FINISHED",
			captureId,
			status: getFinishedStatus(reason),
			stopReason: reason,
			errorMessage,
			elapsedMs: performance.now() - active.startedAt,
		});
	}
}

function getFinishedStatus(reason?: StopReason): "error" | "stopped" {
	if (reason === "error" || reason === "unsupported") {
		return "error";
	}
	return "stopped";
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

function createFailedCaptureMetadata(
	videoId: string,
	descriptor: ReturnType<typeof describeVideo>,
	mimeType: string,
): CaptureMetadata {
	return createCaptureMetadata({
		videoId,
		tabId: 0,
		pageUrl: location.href,
		title: descriptor.title,
		mimeType,
		width: descriptor.width,
		height: descriptor.height,
	});
}

async function finishUnsupportedCapture(
	metadata: CaptureMetadata,
	errorMessage: string,
): Promise<void> {
	await browser.runtime.sendMessage({ type: "CAPTURE_STARTED", metadata });
	await browser.runtime.sendMessage({
		type: "CAPTURE_FINISHED",
		captureId: metadata.id,
		status: "error",
		stopReason: "unsupported",
		errorMessage,
		elapsedMs: 0,
	});
}

function stopStream(stream: MediaStream): void {
	for (const track of stream.getTracks()) {
		track.stop();
	}
}

function getRecorderErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return "MediaRecorder の開始に失敗しました。";
}
