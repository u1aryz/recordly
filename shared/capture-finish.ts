import { t } from "@/utils/i18n";
import type {
	CaptureFinishedMessage,
	CaptureMetadata,
	CaptureProgressMessage,
	StopReason,
} from "./types";

export function isFatalStopReason(reason?: StopReason): boolean {
	return reason === "error" || reason === "write_failed";
}

export function getFinishedStatus(
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

export function getFinalStatus(
	reason: StopReason | undefined,
	hasSavedParts: boolean,
): CaptureFinishedMessage["status"] {
	if (isFatalStopReason(reason) && hasSavedParts) {
		return "stopped";
	}
	return getFinishedStatus(reason);
}

function getCompletionMessage(reason?: StopReason): string {
	switch (reason) {
		case "video_ended":
			return t("completionVideoEnded");
		case "video_removed":
			return t("completionVideoRemoved");
		case "resolution_changed":
			return t("completionResolutionChanged");
		case "source_closed":
			return t("completionSourceClosed");
		case "no_data_timeout":
			return t("stoppedAfterNoDataTimeout");
		default:
			return t("completionDefault");
	}
}

export function getHudResult(
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
			message: errorMessage ?? t("recordingFileSaveFailed"),
			tone: "error",
		};
	}
	if (reason && reason !== "user") {
		return { message: getCompletionMessage(reason), tone: "warning" };
	}
	return { message: getCompletionMessage(reason), tone: "success" };
}

export function getErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return fallback;
}

export function createProgressMessage(
	metadata: CaptureMetadata,
): CaptureProgressMessage {
	return {
		type: "CAPTURE_PROGRESS",
		captureId: metadata.id,
		sizeBytes: metadata.sizeBytes,
		elapsedMs: metadata.elapsedMs,
		chunkCount: metadata.chunkCount,
		partCount: metadata.partCount ?? 1,
		savedPartCount: metadata.savedPartCount ?? 0,
		currentPartSizeBytes: metadata.currentPartSizeBytes ?? 0,
		resolutionChanges: metadata.resolutionChanges,
	};
}

export function createCaptureFinishedMessage(
	metadata: CaptureMetadata,
	input: { stopReason?: StopReason; errorMessage?: string; elapsedMs: number },
): CaptureFinishedMessage {
	const hasSavedParts = (metadata.savedPartCount ?? 0) > 0;
	return {
		type: "CAPTURE_FINISHED",
		captureId: metadata.id,
		status: getFinalStatus(input.stopReason, hasSavedParts),
		fileStatus: hasSavedParts ? "saved" : "failed",
		stopReason: input.stopReason === "user" ? undefined : input.stopReason,
		resolutionChange: metadata.resolutionChange,
		resolutionChanges: metadata.resolutionChanges,
		errorMessage: input.errorMessage,
		elapsedMs: input.elapsedMs,
		sizeBytes: metadata.sizeBytes,
		chunkCount: metadata.chunkCount,
		partCount: metadata.partCount ?? 1,
		savedPartCount: metadata.savedPartCount ?? 0,
		currentPartSizeBytes: metadata.currentPartSizeBytes ?? 0,
	};
}

export function reduceStopReason(
	current: { stopReason?: StopReason; errorMessage?: string },
	next: { stopReason: StopReason; errorMessage?: string },
): { stopReason?: StopReason; errorMessage?: string } {
	if (!current.stopReason || isFatalStopReason(next.stopReason)) {
		return { stopReason: next.stopReason, errorMessage: next.errorMessage };
	}
	return current;
}
