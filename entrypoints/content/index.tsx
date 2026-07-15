import "./style.css";
import {
	createProgressMessage,
	getErrorMessage,
	getHudResult,
} from "@/shared/capture-finish";
import { createCaptureMetadata } from "@/shared/capture-state";
import { isFilePickerAbortError } from "@/shared/file-system";
import { isExtensionMessage } from "@/shared/message";
import {
	createMonitorState,
	evaluateRecordingTick,
	type MonitorState,
} from "@/shared/recording-monitor";
import {
	type RecordingSession,
	startRecordingSession,
} from "@/shared/recording-session";
import {
	continueOnResolutionChange,
	recordingHudPosition,
} from "@/shared/settings";
import type {
	CaptureStreamPortMessage,
	ResolutionChange,
	StopReason,
	VideoDescriptor,
	VideoResolution,
} from "@/shared/types";
import {
	createVideoCaptureStream,
	describeVideo,
	formatResolution,
	getMp4MimeType,
	isVideoConnected,
	listVideos,
	stopMediaStreamTracks,
} from "@/shared/video";
import { t } from "@/utils/i18n";
import {
	createRecordingHudUi,
	type RecordingHudManager,
} from "./recording-hud-ui";
import {
	createVideoPickerUi,
	type VideoPickerStartResult,
} from "./video-picker-ui";

type ActiveRecording = {
	session: RecordingSession;
	stream: MediaStream;
	port: Browser.runtime.Port;
	continueOnResolutionChange: boolean;
	monitorState: MonitorState;
	resolutionTimer: number;
};

const activeRecordings = new Map<string, ActiveRecording>();
let latestContinueOnResolutionChange: boolean | undefined;
let recordingHud: RecordingHudManager | undefined;

export default defineContentScript({
	matches: ["<all_urls>"],
	allFrames: false,
	runAt: "document_idle",
	cssInjectionMode: "ui",
	main(ctx) {
		recordingHud = createRecordingHudUi(ctx, {
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
		const picker = createVideoPickerUi(ctx, { onStart: startRecording });

		const unwatchContinueOnResolutionChange = continueOnResolutionChange.watch(
			(value) => {
				latestContinueOnResolutionChange = value;
				for (const active of activeRecordings.values()) {
					active.continueOnResolutionChange = value;
				}
			},
		);

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
			unwatchContinueOnResolutionChange();
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
		recordingHud?.highlight(existing.session.getMetadata().id);
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

	const port = browser.runtime.connect({ name: "capture-stream" });
	const continueOnResolutionChangeEnabled =
		await continueOnResolutionChange.getValue();

	let active: ActiveRecording | undefined;
	const result = await startRecordingSession({
		metadata,
		stream,
		directory,
		callbacks: {
			onProgress(current) {
				recordingHud?.update(current.id, current.elapsedMs);
				postCaptureStreamMessage(port, createProgressMessage(current));
			},
			onStopping(elapsedMs) {
				recordingHud?.markStopping(metadata.id, elapsedMs);
			},
			onPartStarted(current, change) {
				recordingHud?.updatePart(current.id, current.partCount ?? 1, {
					width: current.width,
					height: current.height,
				});
				postCaptureStreamMessage(port, createProgressMessage(current));
				if (change) {
					recordingHud?.notify(
						current.id,
						t("resolutionRolloverHud", [
							formatResolution(change.from),
							formatResolution(change.to),
						]),
					);
				}
			},
			onFinished(outcome) {
				try {
					postCaptureStreamMessage(port, outcome.message);
					const hudResult = getHudResult(
						outcome.stopReason,
						outcome.errorMessage,
						outcome.hasSavedParts,
					);
					recordingHud?.finish(metadata.id, hudResult.message, hudResult.tone);
				} finally {
					if (active) {
						window.clearInterval(active.resolutionTimer);
					}
					activeRecordings.delete(metadata.id);
					port.disconnect();
				}
			},
		},
	});

	if (!result.ok) {
		port.disconnect();
		stopMediaStreamTracks(stream);
		return {
			ok: false,
			reason: result.errorMessage ?? t("mediaRecorderStartFailed"),
		};
	}

	active = {
		session: result.session,
		stream,
		port,
		continueOnResolutionChange:
			latestContinueOnResolutionChange ?? continueOnResolutionChangeEnabled,
		monitorState: createMonitorState(),
		resolutionTimer: 0,
	};
	activeRecordings.set(metadata.id, active);
	recordingHud?.add(metadata);
	bindRecordingEvents(active, video);
	const startedMetadata = result.session.getMetadata();
	postCaptureStreamMessage(port, {
		type: "CAPTURE_STARTED",
		metadata: startedMetadata,
	});
	recordingHud?.updatePart(metadata.id, startedMetadata.partCount ?? 1, {
		width: startedMetadata.width,
		height: startedMetadata.height,
	});
	recordingHud?.update(metadata.id, 0);
	return { ok: true };
}

function findActiveRecordingByVideoId(
	videoId: string,
): ActiveRecording | undefined {
	for (const active of activeRecordings.values()) {
		if (
			active.session.getMetadata().videoId === videoId &&
			!active.session.isFinished()
		) {
			return active;
		}
	}
	return undefined;
}

function bindRecordingEvents(
	active: ActiveRecording,
	video: HTMLVideoElement,
): void {
	const captureId = active.session.getMetadata().id;
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

function stopCapture(
	captureId: string,
	stopReason: StopReason,
	errorMessage?: string,
	resolutionChange?: ResolutionChange,
): void {
	const active = activeRecordings.get(captureId);
	if (!active || active.session.isFinished()) {
		return;
	}
	window.clearInterval(active.resolutionTimer);
	active.session.stop(stopReason, errorMessage, resolutionChange);
}

function stopAllRecordings(
	stopReason: StopReason,
	errorMessage?: string,
): void {
	for (const captureId of activeRecordings.keys()) {
		stopCapture(captureId, stopReason, errorMessage);
	}
}

function createResolutionTimer(
	video: HTMLVideoElement,
	active: ActiveRecording,
): number {
	return window.setInterval(() => {
		const metadata = active.session.getMetadata();
		const commands = evaluateRecordingTick(active.monitorState, {
			connected: isVideoConnected(video),
			current: getCurrentVideoResolution(video),
			recorded: {
				width: metadata.width,
				height: metadata.height,
			},
			continueOnResolutionChange: active.continueOnResolutionChange,
			recorderRecording: active.session.isRecorderRecording(),
			paused: video.paused,
			seeking: video.seeking,
			nowMs: performance.now(),
			lastDataAtMs: active.session.getLastDataAt(),
		});
		for (const command of commands) {
			if (command.type === "rollover") {
				active.session.rollover(command.change);
			} else if (command.reason === "resolution_changed") {
				stopCapture(
					metadata.id,
					"resolution_changed",
					undefined,
					command.change,
				);
			} else {
				stopCapture(metadata.id, command.reason);
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
	try {
		port.postMessage(message);
	} catch {
		// The port drops when the background service worker is torn down;
		// runtime.sendMessage respawns the worker so the message still lands.
		void browser.runtime.sendMessage(message).catch(() => undefined);
	}
}
