import {
	ArrowDownTrayIcon,
	CheckCircleIcon,
	ExclamationTriangleIcon,
	InformationCircleIcon,
	StopIcon,
	TrashIcon,
	XCircleIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, JSX, ReactNode, SVGProps } from "react";
import type { CaptureTone } from "@/shared/capture-presentation";
import {
	getCapturePresentation,
	getStatusBadgeClass,
} from "@/shared/capture-presentation";
import type { CaptureMetadata, ResolutionChangeEvent } from "@/shared/types";
import { formatBytes, formatDuration, formatResolution } from "@/shared/video";
import { t } from "@/utils/i18n";
import { getPageHost } from "./capture-view-state";

type CaptureDetailProps = {
	capture: CaptureMetadata;
	isDeleting: boolean;
	isDownloading: boolean;
	isStopping: boolean;
	onStop: () => void;
	onDownload: () => void;
	onDelete: () => void;
};

type CaptureAlertProps = {
	children: ReactNode;
	className?: string;
	tone: CaptureTone;
};

type CaptureMetricProps = {
	label: string;
	value: string;
};

type StatusBadgeProps = {
	capture: CaptureMetadata;
};

type AlertPresentation = {
	Icon: ComponentType<SVGProps<SVGSVGElement>>;
	alertClassName: string;
	iconClassName: string;
};

export function CaptureDetail({
	capture,
	isDeleting,
	isDownloading,
	isStopping,
	onStop,
	onDownload,
	onDelete,
}: CaptureDetailProps): JSX.Element {
	const isRecording = capture.status === "recording";
	const isDirectFile =
		capture.storageMode === "direct-file" ||
		capture.storageMode === "segmented-files";
	const isSegmented = capture.storageMode === "segmented-files";
	const presentation = getCapturePresentation(capture);
	const shouldShowStatusAlert = presentation.tone !== "info";
	return (
		<div>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
				<div className="min-w-0">
					<h2 className="wrap-break-word font-semibold text-lg">
						{capture.title}
					</h2>
					<p className="truncate text-base-content/65 text-sm">
						{getPageHost(capture.pageUrl)}
					</p>
				</div>
				<StatusBadge capture={capture} />
			</div>

			{shouldShowStatusAlert ? (
				<CaptureAlert className="mt-4" tone={presentation.tone}>
					<span>
						<strong className="block">{presentation.title}</strong>
						<span className="mt-1 block text-sm">
							{presentation.description}
						</span>
					</span>
				</CaptureAlert>
			) : null}

			<div
				className={getCaptureContentClassName(
					Boolean(capture.thumbnailDataUrl),
				)}
			>
				{capture.thumbnailDataUrl ? (
					<div className="aspect-video overflow-hidden rounded-box bg-neutral">
						<img
							alt=""
							className="h-full w-full object-contain"
							src={capture.thumbnailDataUrl}
						/>
					</div>
				) : null}
				<dl className="overflow-hidden rounded-box border border-base-300 bg-base-100">
					<CaptureMetric
						label={t("elapsedTime")}
						value={formatDuration(capture.elapsedMs)}
					/>
					<CaptureMetric
						label={t("fileSize")}
						value={formatBytes(capture.sizeBytes)}
					/>
					{isSegmented ? (
						<CaptureMetric
							label={t("fileCount")}
							value={getPartCountLabel(capture)}
						/>
					) : null}
					<CaptureMetric
						label={t("resolution")}
						value={getResolutionLabel(capture)}
					/>
				</dl>
			</div>

			{capture.resolutionChanges?.length ? (
				<ResolutionChangeHistory changes={capture.resolutionChanges} />
			) : null}

			{isDirectFile && !isRecording ? (
				<p className="mt-4 text-base-content/65 text-sm">
					{isSegmented
						? t("mp4PartsAtSelectedDestination")
						: t("mp4AtSelectedDestination")}
				</p>
			) : null}

			<div className="mt-6 flex flex-wrap gap-2">
				{isRecording ? (
					<button
						className="btn btn-warning"
						disabled={isStopping}
						type="button"
						onClick={onStop}
					>
						{isStopping ? (
							<span className="loading loading-spinner loading-sm" />
						) : (
							<StopIcon className="h-5 w-5" />
						)}
						{isStopping ? t("stoppingAndSaving") : t("stopAndSave")}
					</button>
				) : null}
				{!isRecording && !isDirectFile ? (
					<button
						className="btn btn-primary"
						disabled={isDownloading}
						type="button"
						onClick={onDownload}
					>
						{isDownloading ? (
							<span
								aria-hidden="true"
								className="loading loading-spinner loading-sm"
							/>
						) : (
							<ArrowDownTrayIcon className="h-5 w-5" />
						)}
						{t("saveMp4")}
					</button>
				) : null}
				{!isRecording ? (
					<button
						className="btn btn-ghost text-error"
						disabled={isDeleting}
						type="button"
						onClick={onDelete}
					>
						{isDeleting ? (
							<span
								aria-hidden="true"
								className="loading loading-spinner loading-sm"
							/>
						) : (
							<TrashIcon className="h-5 w-5" />
						)}
						{isDirectFile ? t("removeFromHistory") : t("delete")}
					</button>
				) : null}
			</div>
		</div>
	);
}

export function getPartCountLabel(capture: CaptureMetadata): string {
	if (capture.status === "recording") {
		return t("recordingPart", String(capture.partCount ?? 1));
	}
	return String(capture.savedPartCount ?? capture.partCount ?? 0);
}

export function getResolutionLabel(capture: CaptureMetadata): string {
	const changes = capture.resolutionChanges;
	const latest = changes?.[changes.length - 1];
	if (latest) {
		return formatResolution(latest.to);
	}
	return formatResolution({ width: capture.width, height: capture.height });
}

function ResolutionChangeHistory({
	changes,
}: {
	changes: ResolutionChangeEvent[];
}): JSX.Element {
	return (
		<details className="collapse-arrow collapse mt-4 rounded-box border border-base-300 bg-base-100">
			<summary className="collapse-title min-h-0 py-3 font-medium text-sm">
				{t("resolutionChangeSplits")} ({changes.length})
			</summary>
			<div className="collapse-content">
				<ul className="space-y-1.5 text-sm">
					{changes.map((change) => (
						<li
							className="flex items-center justify-between gap-3"
							key={change.partIndex}
						>
							<span className="text-base-content/60">
								{t("resolutionChangePartLabel", String(change.partIndex))}
							</span>
							<span className="flex items-center gap-2">
								{formatResolution(change.from)} → {formatResolution(change.to)}
								{change.fileDiscarded ? (
									<span className="badge badge-soft badge-warning badge-sm whitespace-nowrap">
										{t("resolutionChangeFileDiscarded")}
									</span>
								) : null}
							</span>
						</li>
					))}
				</ul>
			</div>
		</details>
	);
}

export function CaptureAlert({
	children,
	className,
	tone,
}: CaptureAlertProps): JSX.Element {
	const { Icon, alertClassName, iconClassName } = getAlertPresentation(tone);
	return (
		<div
			className={`alert alert-soft ${alertClassName} ${className ?? ""}`}
			role="alert"
		>
			<Icon
				aria-hidden="true"
				className={`h-5 w-5 shrink-0 ${iconClassName}`}
			/>
			<span>{children}</span>
		</div>
	);
}

export function getAlertPresentation(tone: CaptureTone): AlertPresentation {
	switch (tone) {
		case "success":
			return {
				Icon: CheckCircleIcon,
				alertClassName: "alert-success",
				iconClassName: "text-success",
			};
		case "warning":
			return {
				Icon: ExclamationTriangleIcon,
				alertClassName: "alert-warning",
				iconClassName: "text-warning",
			};
		case "error":
			return {
				Icon: XCircleIcon,
				alertClassName: "alert-error",
				iconClassName: "text-error",
			};
		default:
			return {
				Icon: InformationCircleIcon,
				alertClassName: "alert-info",
				iconClassName: "text-info",
			};
	}
}

export function StatusBadge({ capture }: StatusBadgeProps): JSX.Element {
	const presentation = getCapturePresentation(capture);
	return (
		<span className={getStatusBadgeClass(capture.status, presentation.tone)}>
			{presentation.label}
		</span>
	);
}

export function getProgressSummary(capture: CaptureMetadata): string {
	const { label } = getCapturePresentation(capture);
	return `${label} / ${formatDuration(capture.elapsedMs)} / ${formatBytes(capture.sizeBytes)}`;
}

function getCaptureContentClassName(hasThumbnail: boolean): string {
	if (hasThumbnail) {
		return "mt-5 grid gap-5 lg:grid-cols-[minmax(260px,420px)_1fr]";
	}
	return "mt-5 grid gap-5";
}

function CaptureMetric({ label, value }: CaptureMetricProps): JSX.Element {
	return (
		<div className="flex items-baseline justify-between gap-4 border-base-300 border-b p-4 last:border-b-0">
			<dt className="text-base-content/60 text-xs">{label}</dt>
			<dd className="text-right font-semibold text-base">{value}</dd>
		</div>
	);
}
