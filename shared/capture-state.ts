import type { CaptureMetadata, CaptureProgress, StopReason } from "./types";

export function createCaptureMetadata(input: {
	videoId: string;
	tabId: number;
	pageUrl: string;
	title: string;
	mimeType: string;
	width: number;
	height: number;
	thumbnailDataUrl?: string;
}): CaptureMetadata {
	const id = crypto.randomUUID();
	const startedAt = Date.now();
	const safeTitle = input.title
		.replace(/[^\w.-]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return {
		id,
		videoId: input.videoId,
		tabId: input.tabId,
		pageUrl: input.pageUrl,
		title: input.title,
		startedAt,
		status: "recording",
		mimeType: input.mimeType,
		fileName: `${safeTitle || "capture"}-${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}.mp4`,
		sizeBytes: 0,
		elapsedMs: 0,
		width: input.width,
		height: input.height,
		thumbnailDataUrl: input.thumbnailDataUrl,
		chunkCount: 0,
	};
}

export function applyProgress(
	metadata: CaptureMetadata,
	progress: Pick<CaptureProgress, "sizeBytes" | "elapsedMs" | "chunkCount">,
): CaptureMetadata {
	return {
		...metadata,
		sizeBytes: progress.sizeBytes,
		elapsedMs: progress.elapsedMs,
		chunkCount: progress.chunkCount,
	};
}

export function finishCapture(
	metadata: CaptureMetadata,
	input: {
		status: "stopped" | "error" | "complete";
		elapsedMs: number;
		stopReason?: StopReason;
		errorMessage?: string;
	},
): CaptureMetadata {
	return {
		...metadata,
		status: input.status,
		elapsedMs: input.elapsedMs,
		endedAt: Date.now(),
		stopReason: input.stopReason,
		errorMessage: input.errorMessage,
	};
}
