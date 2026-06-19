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
	ReactNode,
	SetStateAction,
	SVGProps,
} from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	getCapturePresentation,
	getStatusBadgeClass,
} from "@/shared/capture-presentation";
import { createCaptureReadableStream, listCaptures } from "@/shared/storage";
import type { CaptureMetadata, PortMessage } from "@/shared/types";
import { formatBytes, formatDuration } from "@/shared/video";

type SaveFilePickerOptions = {
	suggestedName?: string;
	startIn?: string;
	types?: {
		description?: string;
		accept: Record<string, string[]>;
	}[];
};

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
	tone: "info" | "success" | "warning" | "error";
};

type StatProps = {
	label: string;
	value: string;
	compact?: boolean;
};

const MP4_FILE_PICKER_TYPES = [
	{
		description: "MP4 video",
		accept: { "video/mp4": [".mp4"] },
	},
];
declare global {
	interface Window {
		showSaveFilePicker?: (
			options?: SaveFilePickerOptions,
		) => Promise<FileSystemFileHandle>;
	}
}

function App() {
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

	const selected = useMemo(
		() => captures.find((capture) => capture.id === selectedId) ?? captures[0],
		[captures, selectedId],
	);

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

	const upsertCapture = useCallback((capture: CaptureMetadata) => {
		setCaptures((current) => {
			const without = current.filter((item) => item.id !== capture.id);
			return [capture, ...without].sort((a, b) => b.startedAt - a.startedAt);
		});
	}, []);

	useEffect(() => {
		void reload();
		const port = browser.runtime.connect({ name: "captures" });
		port.postMessage({ type: "CAPTURES_SUBSCRIBE" });
		port.onMessage.addListener((event: PortMessage) => {
			handlePortMessage(event, {
				setCaptures,
				setSelectedId,
				upsertCapture,
			});
		});
		return () => port.disconnect();
	}, [reload, upsertCapture]);

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
			if (error instanceof DOMException && error.name === "AbortError") {
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

function CaptureDetail({
	capture,
	isDeleting,
	isDownloading,
	isStopping,
	onStop,
	onDownload,
	onDelete,
}: CaptureDetailProps) {
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

function CaptureAlert({ children, className, tone }: CaptureAlertProps) {
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

function getAlertPresentation(tone: "info" | "success" | "warning" | "error"): {
	Icon: ComponentType<SVGProps<SVGSVGElement>>;
	alertClassName: string;
	iconClassName: string;
} {
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

function StatusBadge({ capture }: { capture: CaptureMetadata }) {
	const presentation = getCapturePresentation(capture);
	return (
		<span className={getStatusBadgeClass(capture.status, presentation.tone)}>
			{presentation.label}
		</span>
	);
}

function getProgressSummary(capture: CaptureMetadata) {
	const { label } = getCapturePresentation(capture);
	return `${label} / ${formatDuration(capture.elapsedMs)} / ${formatBytes(capture.sizeBytes)}`;
}

function handlePortMessage(
	event: PortMessage,
	handlers: {
		setCaptures: Dispatch<SetStateAction<CaptureMetadata[]>>;
		setSelectedId: Dispatch<SetStateAction<string | null>>;
		upsertCapture: (capture: CaptureMetadata) => void;
	},
) {
	switch (event.type) {
		case "CAPTURE_CREATED":
		case "CAPTURE_UPDATED":
			handlers.upsertCapture(event.metadata);
			handlers.setSelectedId((current) => current ?? event.metadata.id);
			return;
		case "CAPTURE_PROGRESS":
			handlers.setCaptures((current) =>
				current.map((capture) =>
					capture.id === event.progress.id
						? {
								...capture,
								...event.progress,
								thumbnailDataUrl:
									event.progress.thumbnailDataUrl ?? capture.thumbnailDataUrl,
							}
						: capture,
				),
			);
			return;
		case "CAPTURE_DELETED":
			handlers.setCaptures((current) =>
				current.filter((capture) => capture.id !== event.captureId),
			);
			handlers.setSelectedId((current) =>
				current === event.captureId ? null : current,
			);
			return;
		case "CAPTURES_SUBSCRIBE":
			return;
	}
}

function Stat({ label, value, compact = false }: StatProps) {
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
