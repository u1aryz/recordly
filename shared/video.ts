import type { VideoDescriptor } from "./types";

const VIDEO_ID_ATTR = "data-vcap-id";
const MP4_MIME_TYPE_CANDIDATES = [
	'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
	'video/mp4;codecs="avc1.42E01E"',
	"video/mp4",
];

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

export function createVideoCaptureStream(video: HTMLVideoElement): {
	stream: MediaStream | null;
	errorMessage?: string;
} {
	const captureStream = getVideoCaptureStream(video);
	if (!captureStream) {
		return {
			stream: null,
			errorMessage: "このブラウザでは video.captureStream() が使えません",
		};
	}

	try {
		return { stream: captureStream() };
	} catch (error) {
		return {
			stream: null,
			errorMessage: getCaptureStreamErrorMessage(error),
		};
	}
}

function getVideoCaptureStream(
	video: HTMLVideoElement,
): (() => MediaStream) | null {
	if (typeof video.captureStream === "function") {
		return video.captureStream.bind(video);
	}
	if (typeof video.mozCaptureStream === "function") {
		return video.mozCaptureStream.bind(video);
	}
	return null;
}

export function getMp4MimeType(): string | null {
	if (!("MediaRecorder" in globalThis)) {
		return null;
	}
	return (
		MP4_MIME_TYPE_CANDIDATES.find((mimeType) =>
			MediaRecorder.isTypeSupported(mimeType),
		) ?? null
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

function getCaptureStreamErrorMessage(error: unknown): string {
	if (error instanceof DOMException && error.name === "NotSupportedError") {
		return "この動画は DRM などの保護によりキャプチャできません。";
	}
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return "video.captureStream() の開始に失敗しました。";
}

declare global {
	interface HTMLVideoElement {
		captureStream?: () => MediaStream;
		mozCaptureStream?: () => MediaStream;
		webkitAudioDecodedByteCount?: number;
	}
}
