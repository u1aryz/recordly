import type { VideoDescriptor } from "./types";

const VIDEO_ID_ATTR = "data-vcap-id";

export function getOrCreateVideoId(video: HTMLVideoElement): string {
	const existing = video.getAttribute(VIDEO_ID_ATTR);
	if (existing) {
		return existing;
	}
	const id = crypto.randomUUID();
	video.setAttribute(VIDEO_ID_ATTR, id);
	return id;
}

export function findVideoFromPoint(
	x: number,
	y: number,
	elementsFromPoint: (
		x: number,
		y: number,
	) => Element[] = document.elementsFromPoint.bind(document),
): HTMLVideoElement | null {
	for (const element of elementsFromPoint(x, y)) {
		if (element instanceof HTMLVideoElement) {
			return element;
		}
		const nested = element.querySelector?.("video");
		if (nested instanceof HTMLVideoElement) {
			return nested;
		}
	}
	return null;
}

export function describeVideo(video: HTMLVideoElement): VideoDescriptor {
	const width = video.videoWidth || video.clientWidth || 0;
	const height = video.videoHeight || video.clientHeight || 0;
	const currentSrc = video.currentSrc || video.src || "";
	const canCapture =
		typeof video.captureStream === "function" ||
		typeof video.mozCaptureStream === "function";
	const hasAudio =
		("webkitAudioDecodedByteCount" in video &&
			Number(video.webkitAudioDecodedByteCount) > 0) ||
		!video.muted;

	return {
		id: getOrCreateVideoId(video),
		src: video.src || "",
		currentSrc,
		title:
			video.getAttribute("aria-label") ||
			video.getAttribute("title") ||
			video.ownerDocument.title ||
			"Untitled video",
		width,
		height,
		duration: Number.isFinite(video.duration) ? video.duration : null,
		paused: video.paused,
		muted: video.muted,
		hasAudio,
		canCapture,
		reason: canCapture
			? undefined
			: "このブラウザでは video.captureStream() が使えません",
	};
}

export function listVideos(root: ParentNode = document): VideoDescriptor[] {
	return Array.from(root.querySelectorAll("video")).map(describeVideo);
}

export function getMp4MimeType(): string | null {
	const candidates = [
		'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
		'video/mp4;codecs="avc1.42E01E"',
		"video/mp4",
	];
	if (!("MediaRecorder" in globalThis)) {
		return null;
	}
	return (
		candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ??
		null
	);
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	for (const unit of units) {
		if (value < 1024) {
			return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
		}
		value /= 1024;
	}
	return `${value.toFixed(1)} TB`;
}

declare global {
	interface HTMLVideoElement {
		captureStream?: () => MediaStream;
		mozCaptureStream?: () => MediaStream;
		webkitAudioDecodedByteCount?: number;
	}
}
