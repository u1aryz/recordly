export type CaptureStatus = "recording" | "stopped" | "error" | "complete";

export type CaptureFileStatus = "writing" | "saved" | "failed" | "unknown";

export type StopReason =
	| "user"
	| "resolution_changed"
	| "source_closed"
	| "video_ended"
	| "video_removed"
	| "unsupported"
	| "error"
	| "tab_capture_failed"
	| "target_unavailable"
	| "write_failed";

export type VideoDescriptor = {
	id: string;
	src: string;
	currentSrc: string;
	title: string;
	width: number;
	height: number;
	duration: number | null;
	paused: boolean;
	muted: boolean;
	hasAudio: boolean;
	canCapture: boolean;
	reason?: string;
};

export type CaptureMetadata = {
	id: string;
	videoId: string;
	tabId: number;
	pageUrl: string;
	title: string;
	startedAt: number;
	endedAt?: number;
	status: CaptureStatus;
	fileStatus?: CaptureFileStatus;
	stopReason?: StopReason;
	errorMessage?: string;
	mimeType: string;
	fileName: string;
	sizeBytes: number;
	elapsedMs: number;
	width: number;
	height: number;
	thumbnailDataUrl?: string;
	chunkCount: number;
	storageMode?: "indexeddb" | "direct-file";
	scope?: "element" | "tab";
};

export type CaptureProgress = Pick<
	CaptureMetadata,
	| "id"
	| "status"
	| "sizeBytes"
	| "elapsedMs"
	| "chunkCount"
	| "stopReason"
	| "errorMessage"
	| "thumbnailDataUrl"
>;

export type StartPickerMessage = {
	type: "START_PICKER";
};

export type ListVideosMessage = {
	type: "LIST_VIDEOS";
};

export type StopCaptureMessage = {
	type: "STOP_CAPTURE";
	captureId: string;
};

export type CaptureStartedMessage = {
	type: "CAPTURE_STARTED";
	metadata: CaptureMetadata;
};

export type CaptureProgressMessage = {
	type: "CAPTURE_PROGRESS";
	captureId: string;
	sizeBytes: number;
	elapsedMs: number;
	chunkCount: number;
};

export type CaptureFinishedMessage = {
	type: "CAPTURE_FINISHED";
	captureId: string;
	status: Exclude<CaptureStatus, "recording">;
	fileStatus: Exclude<CaptureFileStatus, "writing">;
	stopReason?: StopReason;
	errorMessage?: string;
	elapsedMs: number;
};

export type OpenCapturesMessage = {
	type: "OPEN_CAPTURES";
	captureId?: string;
};

export type DeleteCaptureMessage = {
	type: "DELETE_CAPTURE";
	captureId: string;
};

export type ExtensionMessage =
	| StartPickerMessage
	| ListVideosMessage
	| StopCaptureMessage
	| CaptureStartedMessage
	| CaptureProgressMessage
	| CaptureFinishedMessage
	| OpenCapturesMessage
	| DeleteCaptureMessage;

export type CaptureStreamPortMessage =
	| CaptureStartedMessage
	| CaptureProgressMessage
	| CaptureFinishedMessage;

export type PortMessage =
	| { type: "CAPTURES_SUBSCRIBE" }
	| { type: "CAPTURE_PROGRESS"; progress: CaptureProgress }
	| { type: "CAPTURE_CREATED"; metadata: CaptureMetadata }
	| { type: "CAPTURE_UPDATED"; metadata: CaptureMetadata }
	| { type: "CAPTURE_DELETED"; captureId: string };
