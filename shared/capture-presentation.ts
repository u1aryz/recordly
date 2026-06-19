import type {
	CaptureFileStatus,
	CaptureMetadata,
	CaptureStatus,
	StopReason,
} from "./types";

export type CaptureTone = "info" | "success" | "warning" | "error";

export type CapturePresentation = {
	label: string;
	title: string;
	description: string;
	tone: CaptureTone;
};

const STOP_REASON_LABELS: Record<StopReason, string> = {
	user: "ユーザー操作で停止しました",
	resolution_changed: "動画の解像度が変わったため自動停止しました",
	source_closed: "録画元のページまたはストリームが閉じられました",
	video_ended: "対象動画の再生が終了しました",
	video_removed: "対象動画がページからなくなったため自動停止しました",
	unsupported: "ブラウザが録画方式に対応していません",
	error: "録画中にエラーが発生しました",
	tab_capture_failed: "タブ録画を開始できませんでした",
	target_unavailable: "対象タブを利用できませんでした",
	write_failed: "ファイルへの書き込みに失敗しました",
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
			label: "録画中",
			title: "録画中・ファイルへ保存中",
			description: "録画データを、開始時に選択した保存先へ書き込んでいます。",
			tone: "info",
		};
	}
	if (fileStatus === "failed") {
		return {
			label: "保存失敗",
			title: "MP4を保存できませんでした",
			description:
				capture.errorMessage ?? "ファイルへの書き込み中に問題が発生しました。",
			tone: "error",
		};
	}
	if (fileStatus === "unknown") {
		return {
			label: "要確認",
			title: "保存状態を確認できません",
			description:
				"録画元との接続が先に切れたため、MP4の保存完了を確認できませんでした。選択した保存先を確認してください。",
			tone: "warning",
		};
	}
	if (capture.status === "stopped") {
		return {
			label: "途中まで保存",
			title: "停止までの内容を保存しました",
			description: `${translateStopReason(capture.stopReason)}。録画開始時に選択した保存先へ、停止までの内容を保存しています。`,
			tone: "warning",
		};
	}
	return {
		label: "保存完了",
		title: "MP4の保存が完了しました",
		description:
			capture.stopReason === "video_ended"
				? "対象動画の再生終了に合わせて録画を終了し、MP4を保存しました。"
				: "録画開始時に選択した保存先へMP4を保存しました。",
		tone: "success",
	};
}

export function getStatusBadgeClass(
	status: CaptureStatus,
	tone: CaptureTone,
): string {
	if (status === "recording") {
		return "badge badge-primary";
	}
	switch (tone) {
		case "success":
			return "badge badge-success";
		case "warning":
			return "badge badge-warning";
		case "error":
			return "badge badge-error";
		default:
			return "badge badge-info";
	}
}

export function translateStopReason(reason?: StopReason): string {
	return reason ? STOP_REASON_LABELS[reason] : "録画を終了しました";
}
