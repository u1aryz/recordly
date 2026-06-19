import {
	ArrowDownTrayIcon,
	CheckCircleIcon,
	ExclamationTriangleIcon,
	FilmIcon,
	InformationCircleIcon,
	StopIcon,
	TrashIcon,
	XCircleIcon,
} from "@heroicons/react/24/outline";
import type {
	ComponentType,
	Dispatch,
	JSX,
	ReactNode,
	SetStateAction,
	SVGProps,
} from "react";
import { useCallback, useEffect, useState } from "react";
import type { CaptureTone } from "@/shared/capture-presentation";
import {
	getCapturePresentation,
	getStatusBadgeClass,
} from "@/shared/capture-presentation";
import {
	isFilePickerAbortError,
	MP4_FILE_PICKER_TYPES,
} from "@/shared/file-system";
import { createCaptureReadableStream, listCaptures } from "@/shared/storage";
import type {
	CaptureMetadata,
	CaptureProgress,
	PortMessage,
} from "@/shared/types";
import { formatBytes, formatDuration } from "@/shared/video";

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

type StatProps = {
	label: string;
	value: string;
	compact?: boolean;
};

type StatusBadgeProps = {
	capture: CaptureMetadata;
};

type AlertPresentation = {
	Icon: ComponentType<SVGProps<SVGSVGElement>>;
	alertClassName: string;
	iconClassName: string;
};

function App(): JSX.Element {
	const [captures, setCaptures] = useState<CaptureMetadata[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(
		new URLSearchParams(location.search).get("captureId"),
	);
	const [message, setMessage] = useState<string | null>(null);
	const [isDownloading, setIsDownloading] = useState(false);
	const [stoppingCaptureId, setStoppingCaptureId] = useState<string | null>(
		null,
	);
	const [loadError, setLoadError] = useState(false);
	const [deletingCaptureId, setDeletingCaptureId] = useState<string | null>(
		null,
	);

	const selected =
		captures.find((capture) => capture.id === selectedId) ?? captures[0];

	const reload = useCallback(async () => {
		try {
			const stored = await listCaptures();
			setCaptures(stored);
			setSelectedId((current) => current ?? stored[0]?.id ?? null);
			setLoadError(false);
		} catch {
			setLoadError(true);
		}
	}, []);

	useEffect(() => {
		void reload();
		const port = browser.runtime.connect({ name: "captures" });
		port.postMessage({ type: "CAPTURES_SUBSCRIBE" });
		port.onMessage.addListener((event: PortMessage) => {
			handlePortMessage(event, setCaptures, setSelectedId);
		});
		return () => port.disconnect();
	}, [reload]);

	useEffect(() => {
		document.title = selected
			? `${getProgressSummary(selected)} - Recordly Captures`
			: "Recordly Captures";
	}, [selected]);

	useEffect(() => {
		if (selected?.status !== "recording") {
			setStoppingCaptureId(null);
		}
	}, [selected?.status]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (
				(event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				isEditableTarget(event.target)
			) {
				return;
			}

			event.preventDefault();
			const key = event.key as "ArrowUp" | "ArrowDown";
			setSelectedId((current) => getAdjacentCaptureId(captures, current, key));
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [captures]);

	async function stopCapture(capture: CaptureMetadata) {
		if (stoppingCaptureId) {
			return;
		}
		setStoppingCaptureId(capture.id);
		try {
			await browser.runtime.sendMessage({
				type: "STOP_CAPTURE",
				captureId: capture.id,
			});
		} catch {
			setStoppingCaptureId(null);
		}
	}

	async function downloadCapture(capture: CaptureMetadata) {
		if (isDownloading) {
			return;
		}
		if (capture.sizeBytes === 0 || capture.chunkCount === 0) {
			setMessage("保存済みデータがありません。");
			return;
		}

		if (!window.showSaveFilePicker) {
			setMessage("このブラウザではストリーミング保存に対応していません。");
			return;
		}

		setIsDownloading(true);
		try {
			const file = await window.showSaveFilePicker({
				suggestedName: capture.fileName,
				startIn: "downloads",
				types: MP4_FILE_PICKER_TYPES,
			});
			const writable = await file.createWritable();
			await createCaptureReadableStream(capture).pipeTo(writable);
		} catch (error) {
			if (isFilePickerAbortError(error)) {
				return;
			}
			throw error;
		} finally {
			setIsDownloading(false);
		}
	}

	async function deleteSelectedCapture(capture: CaptureMetadata) {
		if (deletingCaptureId || capture.status === "recording") {
			return;
		}

		setDeletingCaptureId(capture.id);
		try {
			await browser.runtime.sendMessage({
				type: "DELETE_CAPTURE",
				captureId: capture.id,
			});
			setCaptures((current) =>
				current.filter((item) => item.id !== capture.id),
			);
			setSelectedId((current) => (current === capture.id ? null : current));
		} finally {
			setDeletingCaptureId((current) =>
				current === capture.id ? null : current,
			);
		}
	}

	return (
		<main className="min-h-screen bg-base-100 text-base-content">
			<header className="border-base-300 border-b bg-base-200">
				<div className="mx-auto max-w-6xl px-6 py-4">
					<div>
						<h1 className="flex flex-wrap items-center gap-2 font-semibold text-xl">
							<span>Recordly Captures</span>
							{selected ? (
								<span className="text-base-content/65 text-sm">
									{getProgressSummary(selected)}
								</span>
							) : null}
						</h1>
						<p className="text-base-content/65 text-sm">
							動画キャプチャの進捗確認、停止、履歴管理を行います。
						</p>
					</div>
				</div>
			</header>

			<div className="mx-auto grid max-w-6xl gap-5 px-6 py-6 md:grid-cols-[320px_1fr]">
				<aside className="space-y-2">
					{loadError ? (
						<CaptureAlert tone="error">
							<span>
								履歴を読み込めませんでした。
								<button
									className="btn btn-link btn-sm px-1"
									type="button"
									onClick={reload}
								>
									再試行
								</button>
							</span>
						</CaptureAlert>
					) : null}
					{captures.length === 0 ? (
						<CaptureAlert tone="info">
							まだキャプチャはありません。
						</CaptureAlert>
					) : null}
					{captures.map((capture) => (
						<button
							aria-current={capture.id === selected?.id ? "true" : undefined}
							className={`w-full rounded-box border p-3 text-left ${
								capture.id === selected?.id
									? "border-primary bg-primary/10"
									: "border-base-300 bg-base-200"
							}`}
							key={capture.id}
							type="button"
							onClick={() => setSelectedId(capture.id)}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="flex min-w-0 flex-1 items-center gap-2 font-medium text-sm">
									<FilmIcon className="h-4 w-4 shrink-0 text-base-content/55" />
									<span className="truncate">{capture.title}</span>
								</span>
								<StatusBadge capture={capture} />
							</div>
							<p className="mt-1 text-base-content/60 text-xs">
								{new Date(capture.startedAt).toLocaleString()}
							</p>
							<p className="mt-2 text-xs">
								{formatDuration(capture.elapsedMs)} /{" "}
								{formatBytes(capture.sizeBytes)}
							</p>
						</button>
					))}
				</aside>

				<section className="rounded-box border border-base-300 bg-base-200 p-5">
					{selected ? (
						<CaptureDetail
							capture={selected}
							isDeleting={deletingCaptureId === selected.id}
							isDownloading={isDownloading}
							isStopping={stoppingCaptureId === selected.id}
							onDelete={() => deleteSelectedCapture(selected)}
							onDownload={() => downloadCapture(selected)}
							onStop={() => stopCapture(selected)}
						/>
					) : (
						<div className="flex h-80 items-center justify-center text-base-content/60">
							キャプチャを選択してください。
						</div>
					)}
					{message ? (
						<CaptureAlert className="mt-4" tone="warning">
							{message}
						</CaptureAlert>
					) : null}
				</section>
			</div>
		</main>
	);
}

export function getAdjacentCaptureId(
	captures: CaptureMetadata[],
	selectedId: string | null,
	key: "ArrowUp" | "ArrowDown",
): string | null {
	if (captures.length === 0) {
		return null;
	}

	const selectedIndex = captures.findIndex(
		(capture) => capture.id === selectedId,
	);
	const currentIndex = selectedIndex === -1 ? 0 : selectedIndex;
	const offset = key === "ArrowUp" ? -1 : 1;
	const nextIndex = Math.min(
		Math.max(currentIndex + offset, 0),
		captures.length - 1,
	);
	return captures[nextIndex]?.id ?? null;
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

function CaptureDetail({
	capture,
	isDeleting,
	isDownloading,
	isStopping,
	onStop,
	onDownload,
	onDelete,
}: CaptureDetailProps): JSX.Element {
	const isRecording = capture.status === "recording";
	const isDirectFile = capture.storageMode === "direct-file";
	const presentation = getCapturePresentation(capture);
	return (
		<div>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
				<div className="min-w-0">
					<h2 className="break-words font-semibold text-lg">{capture.title}</h2>
					<p className="truncate text-base-content/65 text-sm">
						{capture.pageUrl}
					</p>
				</div>
				<StatusBadge capture={capture} />
			</div>

			<CaptureAlert className="mt-4" tone={presentation.tone}>
				<span>
					<strong className="block">{presentation.title}</strong>
					<span className="mt-1 block text-sm">{presentation.description}</span>
				</span>
			</CaptureAlert>

			<div className="mt-5 grid gap-5 lg:grid-cols-[minmax(260px,420px)_1fr]">
				<div className="aspect-video overflow-hidden rounded-box bg-neutral">
					{capture.thumbnailDataUrl ? (
						<img
							alt=""
							className="h-full w-full object-contain"
							src={capture.thumbnailDataUrl}
						/>
					) : (
						<div className="flex h-full items-center justify-center text-neutral-content">
							No thumbnail
						</div>
					)}
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<Stat label="経過時間" value={formatDuration(capture.elapsedMs)} />
					<Stat label="ファイルサイズ" value={formatBytes(capture.sizeBytes)} />
					<Stat label="解像度" value={`${capture.width} x ${capture.height}`} />
					<Stat label="ファイル名" value={capture.fileName} compact />
				</div>
			</div>

			{isDirectFile && !isRecording ? (
				<p className="mt-4 text-base-content/65 text-sm">
					録画開始時に選択した保存先を確認してください。ブラウザの制限により、
					Recordlyから保存先フォルダーは表示できません。
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
						{isStopping ? "保存して終了中…" : "停止して保存"}
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
						MP4を保存
					</button>
				) : null}
				<button
					className="btn btn-error"
					disabled={isDeleting || isRecording}
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
					{isDirectFile ? "履歴から削除" : "削除"}
				</button>
			</div>
			{isDirectFile && !isRecording ? (
				<p className="mt-2 text-base-content/60 text-xs">
					履歴を削除しても、保存済みのMP4ファイルは削除されません。
				</p>
			) : null}
		</div>
	);
}

function CaptureAlert({
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

function getAlertPresentation(tone: CaptureTone): AlertPresentation {
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

function StatusBadge({ capture }: StatusBadgeProps): JSX.Element {
	const presentation = getCapturePresentation(capture);
	return (
		<span className={getStatusBadgeClass(capture.status, presentation.tone)}>
			{presentation.label}
		</span>
	);
}

function getProgressSummary(capture: CaptureMetadata): string {
	const { label } = getCapturePresentation(capture);
	return `${label} / ${formatDuration(capture.elapsedMs)} / ${formatBytes(capture.sizeBytes)}`;
}

function handlePortMessage(
	event: PortMessage,
	setCaptures: Dispatch<SetStateAction<CaptureMetadata[]>>,
	setSelectedId: Dispatch<SetStateAction<string | null>>,
): void {
	switch (event.type) {
		case "CAPTURE_CREATED":
		case "CAPTURE_UPDATED":
			setCaptures((current) => upsertCapture(current, event.metadata));
			setSelectedId((current) => current ?? event.metadata.id);
			return;
		case "CAPTURE_PROGRESS":
			setCaptures((current) =>
				current.map((capture) => applyCaptureProgress(capture, event.progress)),
			);
			return;
		case "CAPTURE_DELETED":
			setCaptures((current) =>
				current.filter((capture) => capture.id !== event.captureId),
			);
			setSelectedId((current) =>
				current === event.captureId ? null : current,
			);
			return;
		case "CAPTURES_SUBSCRIBE":
			return;
	}
}

function upsertCapture(
	captures: CaptureMetadata[],
	capture: CaptureMetadata,
): CaptureMetadata[] {
	const remaining = captures.filter((item) => item.id !== capture.id);
	return [capture, ...remaining].sort((a, b) => b.startedAt - a.startedAt);
}

function applyCaptureProgress(
	capture: CaptureMetadata,
	progress: CaptureProgress,
): CaptureMetadata {
	if (capture.id !== progress.id) {
		return capture;
	}
	return {
		...capture,
		...progress,
		thumbnailDataUrl: progress.thumbnailDataUrl ?? capture.thumbnailDataUrl,
	};
}

function Stat({ label, value, compact = false }: StatProps): JSX.Element {
	return (
		<div className="rounded-box bg-base-100 p-4">
			<p className="text-base-content/60 text-xs">{label}</p>
			<p
				className={`mt-1 break-all font-semibold ${compact ? "text-sm" : "text-xl"}`}
			>
				{value}
			</p>
		</div>
	);
}

export default App;
