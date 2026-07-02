import { t } from "../utils/i18n";
import type {
	CaptureFileStatus,
	CaptureMetadata,
	CaptureStatus,
	StopReason,
	VideoResolution,
} from "./types";

export type CaptureTone = "info" | "success" | "warning" | "error";

export type CapturePresentation = {
	label: string;
	title: string;
	description: string;
	tone: CaptureTone;
};

const STOP_REASON_KEYS: Record<StopReason, Parameters<typeof t>[0]> = {
	user: "stopReasonUser",
	resolution_changed: "stopReasonResolutionChanged",
	source_closed: "stopReasonSourceClosed",
	video_ended: "stopReasonVideoEnded",
	video_removed: "stopReasonVideoRemoved",
	unsupported: "stopReasonUnsupported",
	error: "stopReasonError",
	tab_capture_failed: "stopReasonTabCaptureFailed",
	target_unavailable: "stopReasonTargetUnavailable",
	write_failed: "stopReasonWriteFailed",
	no_data_timeout: "stopReasonNoDataTimeout",
};

export function getEffectiveFileStatus(
	capture: CaptureMetadata,
): CaptureFileStatus {
	if (capture.fileStatus) {
		return capture.fileStatus;
	}
	if (capture.storageMode === "direct-file") {
		if (capture.status === "recording") {
			return "writing";
		}
		if (capture.status === "complete") {
			return "saved";
		}
		if (capture.status === "error") {
			return "failed";
		}
		return "unknown";
	}
	return capture.status === "recording" ? "writing" : "saved";
}

export function getCapturePresentation(
	capture: CaptureMetadata,
): CapturePresentation {
	const fileStatus = getEffectiveFileStatus(capture);
	if (capture.status === "recording") {
		return {
			label: t("statusRecording"),
			title: t("recordingAndSaving"),
			description: t("recordingAndSavingDescription"),
			tone: "info",
		};
	}
	if (fileStatus === "failed") {
		return {
			label: t("statusSaveFailed"),
			title: t("saveFailedTitle"),
			description: capture.errorMessage ?? t("saveFailedDescription"),
			tone: "error",
		};
	}
	if (fileStatus === "unknown") {
		return {
			label: t("statusNeedsReview"),
			title: t("saveStatusUnknownTitle"),
			description: t("saveStatusUnknownDescription"),
			tone: "warning",
		};
	}
	if (capture.status === "stopped") {
		return {
			label: t("statusPartiallySaved"),
			title: t("partiallySavedTitle"),
			description: t(
				"partiallySavedDescription",
				translateStopReason(capture.stopReason, capture),
			),
			tone: "warning",
		};
	}
	return {
		label: t("statusSaved"),
		title: t("savedTitle"),
		description:
			capture.stopReason === "video_ended"
				? t("savedAfterVideoEnded")
				: t("savedDescription"),
		tone: "success",
	};
}

export function getStatusBadgeClass(
	status: CaptureStatus,
	tone: CaptureTone,
): string {
	if (status === "recording") {
		return "badge badge-soft badge-primary";
	}
	switch (tone) {
		case "success":
			return "badge badge-soft badge-success";
		case "warning":
			return "badge badge-soft badge-warning";
		case "error":
			return "badge badge-soft badge-error";
		default:
			return "badge badge-soft badge-info";
	}
}

export function translateStopReason(
	reason?: StopReason,
	capture?: CaptureMetadata,
): string {
	if (reason === "resolution_changed" && capture?.resolutionChange) {
		return t("stopReasonResolutionChangedWithDetails", [
			formatResolution(capture.resolutionChange.from),
			formatResolution(capture.resolutionChange.to),
		]);
	}
	return reason ? t(STOP_REASON_KEYS[reason]) : t("stopReasonDefault");
}

function formatResolution(resolution: VideoResolution): string {
	return `${resolution.width} x ${resolution.height}`;
}
