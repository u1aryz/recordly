import {
	ArrowDownTrayIcon,
	ArrowPathIcon,
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
import { getCaptureBlob, listCaptures } from "@/shared/storage";
import type { CaptureMetadata, PortMessage } from "@/shared/types";
import { formatBytes, formatDuration } from "@/shared/video";

function App() {
	const [captures, setCaptures] = useState<CaptureMetadata[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(
		new URLSearchParams(location.search).get("captureId"),
	);
	const [message, setMessage] = useState<string | null>(null);

	const selected = useMemo(
		() => captures.find((capture) => capture.id === selectedId) ?? captures[0],
		[captures, selectedId],
	);

	const reload = useCallback(async () => {
		const stored = await listCaptures();
		setCaptures(stored);
		setSelectedId((current) => current ?? stored[0]?.id ?? null);
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
		setMessage(null);
	}, []);

	useEffect(() => {
		document.title = selected
			? `${getProgressSummary(selected)} - Video Captures`
			: "Video Captures";
	}, [selected]);

	async function stopCapture(capture: CaptureMetadata) {
		await browser.tabs.sendMessage(capture.tabId, {
			type: "STOP_CAPTURE",
			captureId: capture.id,
		});
	}

	async function downloadCapture(capture: CaptureMetadata) {
		const blob = await getCaptureBlob(capture);
		if (blob.size === 0) {
			setMessage("保存済みデータがありません。");
			return;
		}
		const url = URL.createObjectURL(blob);
		try {
			await browser.downloads.download({
				url,
				filename: capture.fileName,
				saveAs: true,
			});
		} finally {
			setTimeout(() => URL.revokeObjectURL(url), 30_000);
		}
	}

	async function deleteSelectedCapture(capture: CaptureMetadata) {
		if (capture.status === "recording") {
			await stopCapture(capture);
		}
		await browser.runtime.sendMessage({
			type: "DELETE_CAPTURE",
			captureId: capture.id,
		});
		setCaptures((current) => current.filter((item) => item.id !== capture.id));
		setSelectedId((current) => (current === capture.id ? null : current));
	}

	return (
		<main className="min-h-screen bg-base-100 text-base-content">
			<header className="border-base-300 border-b bg-base-200">
				<div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
					<div>
						<h1 className="flex flex-wrap items-center gap-2 font-semibold text-xl">
							<span>Video Captures</span>
							{selected ? (
								<span className="text-base-content/65 text-sm">
									{getProgressSummary(selected)}
								</span>
							) : null}
						</h1>
						<p className="text-base-content/65 text-sm">
							録画の進捗確認、停止、保存済みファイルのダウンロードを行います。
						</p>
					</div>
					<button className="btn btn-sm" type="button" onClick={reload}>
						<ArrowPathIcon className="h-4 w-4" />
						再読み込み
					</button>
				</div>
			</header>

			<div className="mx-auto grid max-w-6xl gap-5 px-6 py-6 md:grid-cols-[320px_1fr]">
				<aside className="space-y-2">
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
								<StatusBadge status={capture.status} />
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
	onStop,
	onDownload,
	onDelete,
}: {
	capture: CaptureMetadata;
	onStop: () => void;
	onDownload: () => void;
	onDelete: () => void;
}) {
	const isRecording = capture.status === "recording";
	return (
		<div>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="font-semibold text-lg">{capture.title}</h2>
					<p className="text-base-content/65 text-sm">{capture.pageUrl}</p>
				</div>
				<StatusBadge status={capture.status} />
			</div>

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
					<Stat label="チャンク" value={`${capture.chunkCount}`} />
				</div>
			</div>

			{capture.stopReason ? (
				<CaptureAlert className="mt-4" tone="warning">
					停止理由: {translateStopReason(capture.stopReason)}
				</CaptureAlert>
			) : null}
			{capture.errorMessage ? (
				<CaptureAlert className="mt-4" tone="error">
					{capture.errorMessage}
				</CaptureAlert>
			) : null}

			<div className="mt-6 flex flex-wrap gap-2">
				{isRecording ? (
					<button className="btn btn-warning" type="button" onClick={onStop}>
						<StopIcon className="h-5 w-5" />
						停止
					</button>
				) : (
					<button
						className="btn btn-primary"
						type="button"
						onClick={onDownload}
					>
						<ArrowDownTrayIcon className="h-5 w-5" />
						ダウンロード
					</button>
				)}
				<button className="btn btn-error" type="button" onClick={onDelete}>
					<TrashIcon className="h-5 w-5" />
					削除
				</button>
			</div>
		</div>
	);
}

function CaptureAlert({
	children,
	className,
	tone,
}: {
	children: ReactNode;
	className?: string;
	tone: "info" | "warning" | "error";
}) {
	const { Icon, iconClassName } = getAlertPresentation(tone);
	return (
		<div className={`alert alert-soft ${className ?? ""}`} role="alert">
			<Icon
				aria-hidden="true"
				className={`h-5 w-5 shrink-0 ${iconClassName}`}
			/>
			<span>{children}</span>
		</div>
	);
}

function getAlertPresentation(tone: "info" | "warning" | "error"): {
	Icon: ComponentType<SVGProps<SVGSVGElement>>;
	iconClassName: string;
} {
	switch (tone) {
		case "warning":
			return {
				Icon: ExclamationTriangleIcon,
				iconClassName: "text-warning",
			};
		case "error":
			return {
				Icon: XCircleIcon,
				iconClassName: "text-error",
			};
		default:
			return {
				Icon: InformationCircleIcon,
				iconClassName: "text-info",
			};
	}
}

function StatusBadge({ status }: { status: CaptureMetadata["status"] }) {
	const { className, label } = getStatusPresentation(status);
	return <span className={className}>{label}</span>;
}

function getProgressSummary(capture: CaptureMetadata) {
	const { label } = getStatusPresentation(capture.status);
	return `${label} / ${formatDuration(capture.elapsedMs)} / ${formatBytes(capture.sizeBytes)}`;
}

function getStatusPresentation(status: CaptureMetadata["status"]) {
	switch (status) {
		case "recording":
			return { className: "badge badge-primary", label: "録画中" };
		case "error":
			return { className: "badge badge-error", label: "エラー" };
		default:
			return { className: "badge", label: "停止済み" };
	}
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

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-box bg-base-100 p-4">
			<p className="text-base-content/60 text-xs">{label}</p>
			<p className="mt-1 font-semibold text-xl">{value}</p>
		</div>
	);
}

function translateStopReason(reason: string) {
	const map: Record<string, string> = {
		user: "ユーザー操作",
		resolution_changed: "解像度変更",
		source_closed: "元タブが閉じられました",
		video_removed: "video がページから削除されました",
		unsupported: "ブラウザ非対応",
		error: "録画エラー",
	};
	return map[reason] ?? reason;
}

export default App;
