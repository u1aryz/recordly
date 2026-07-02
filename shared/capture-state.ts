import type {
	CaptureMetadata,
	CaptureProgress,
	ResolutionChange,
	ResolutionChangeEvent,
	StopReason,
} from "./types";

export function createCaptureMetadata(input: {
	videoId: string;
	tabId: number;
	pageUrl: string;
	title: string;
	mimeType: string;
	width: number;
	height: number;
	thumbnailDataUrl?: string;
	status?: CaptureMetadata["status"];
	fileStatus?: CaptureMetadata["fileStatus"];
	storageMode?: CaptureMetadata["storageMode"];
	scope?: CaptureMetadata["scope"];
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
		status: input.status ?? "recording",
		fileStatus: input.fileStatus,
		mimeType: input.mimeType,
		fileName: `${safeTitle || "capture"}-${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}.mp4`,
		sizeBytes: 0,
		elapsedMs: 0,
		width: input.width,
		height: input.height,
		thumbnailDataUrl: input.thumbnailDataUrl,
		chunkCount: 0,
		partCount: input.storageMode === "segmented-files" ? 1 : undefined,
		savedPartCount: input.storageMode === "segmented-files" ? 0 : undefined,
		currentPartSizeBytes:
			input.storageMode === "segmented-files" ? 0 : undefined,
		storageMode: input.storageMode,
		scope: input.scope,
	};
}

export function applyProgress(
	metadata: CaptureMetadata,
	progress: Pick<
		CaptureProgress,
		| "sizeBytes"
		| "elapsedMs"
		| "chunkCount"
		| "partCount"
		| "savedPartCount"
		| "currentPartSizeBytes"
		| "resolutionChanges"
	>,
): CaptureMetadata {
	return {
		...metadata,
		sizeBytes: progress.sizeBytes,
		elapsedMs: progress.elapsedMs,
		chunkCount: progress.chunkCount,
		partCount: progress.partCount ?? metadata.partCount,
		savedPartCount: progress.savedPartCount ?? metadata.savedPartCount,
		currentPartSizeBytes:
			progress.currentPartSizeBytes ?? metadata.currentPartSizeBytes,
		resolutionChanges: progress.resolutionChanges ?? metadata.resolutionChanges,
	};
}

export function markResolutionChangeFileDiscarded(
	changes: ResolutionChangeEvent[] | undefined,
	partIndex: number,
): ResolutionChangeEvent[] | undefined {
	if (!changes?.some((change) => change.partIndex === partIndex)) {
		return changes;
	}
	return changes.map((change) =>
		change.partIndex === partIndex
			? { ...change, fileDiscarded: true }
			: change,
	);
}

export function finishCapture(
	metadata: CaptureMetadata,
	input: {
		status: "stopped" | "error" | "complete";
		fileStatus?: CaptureMetadata["fileStatus"];
		elapsedMs: number;
		stopReason?: StopReason;
		resolutionChange?: ResolutionChange;
		errorMessage?: string;
	},
): CaptureMetadata {
	return {
		...metadata,
		status: input.status,
		fileStatus: input.fileStatus ?? metadata.fileStatus,
		elapsedMs: input.elapsedMs,
		endedAt: Date.now(),
		stopReason: input.stopReason,
		resolutionChange: input.resolutionChange,
		errorMessage: input.errorMessage,
	};
}
