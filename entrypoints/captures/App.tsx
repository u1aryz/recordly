import { FilmIcon } from "@heroicons/react/24/outline";
import type { JSX } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
	isFilePickerAbortError,
	MP4_FILE_PICKER_TYPES,
} from "@/shared/file-system";
import { createCaptureReadableStream, listCaptures } from "@/shared/storage";
import type { CaptureMetadata, PortMessage } from "@/shared/types";
import { formatDuration } from "@/shared/video";
import { t } from "@/utils/i18n";
import {
	CaptureAlert,
	CaptureDetail,
	getProgressSummary,
	StatusBadge,
} from "./CaptureDetail";
import {
	isCaptureDeleteKey,
	isEditableTarget,
	reduceCaptureViewOnPortMessage,
} from "./capture-view-state";

function App(): JSX.Element {
	const [{ captures, selectedId }, dispatch] = useReducer(
		reduceCaptureViewOnPortMessage,
		{
			captures: [],
			selectedId: new URLSearchParams(location.search).get("captureId"),
		},
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
	const [rejectedDeleteCaptureId, setRejectedDeleteCaptureId] = useState<
		string | null
	>(null);
	const rejectedDeleteFrameRef = useRef<number | null>(null);
	const selectedCaptureRef = useRef<HTMLButtonElement>(null);

	const selected =
		captures.find((capture) => capture.id === selectedId) ?? captures[0];
	const selectedCaptureId = selected?.id;

	const reload = useCallback(async () => {
		try {
			const stored = await listCaptures();
			dispatch({ type: "CAPTURES_LOADED", captures: stored });
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
			dispatch(event);
		});
		return () => port.disconnect();
	}, [reload]);

	useEffect(() => {
		document.title = selected
			? `${getProgressSummary(selected)} - ${t("capturesTitle")}`
			: t("capturesTitle");
	}, [selected]);

	useEffect(() => {
		if (selected?.status !== "recording") {
			setStoppingCaptureId(null);
		}
	}, [selected?.status]);

	useEffect(() => {
		if (!selectedCaptureId) {
			return;
		}
		selectedCaptureRef.current?.scrollIntoView({
			block: "nearest",
		});
	}, [selectedCaptureId]);

	useEffect(() => {
		return () => {
			if (rejectedDeleteFrameRef.current !== null) {
				cancelAnimationFrame(rejectedDeleteFrameRef.current);
			}
		};
	}, []);

	const rejectRecordingDelete = useCallback((captureId: string) => {
		if (rejectedDeleteFrameRef.current !== null) {
			cancelAnimationFrame(rejectedDeleteFrameRef.current);
		}
		setRejectedDeleteCaptureId(null);
		rejectedDeleteFrameRef.current = requestAnimationFrame(() => {
			setRejectedDeleteCaptureId(captureId);
			rejectedDeleteFrameRef.current = null;
		});
	}, []);

	const deleteSelectedCapture = useCallback(
		async (capture: CaptureMetadata) => {
			if (deletingCaptureId || capture.status === "recording") {
				return;
			}

			setDeletingCaptureId(capture.id);
			try {
				await browser.runtime.sendMessage({
					type: "DELETE_CAPTURE",
					captureId: capture.id,
				});
				dispatch({ type: "CAPTURE_DELETED", captureId: capture.id });
			} finally {
				setDeletingCaptureId((current) =>
					current === capture.id ? null : current,
				);
			}
		},
		[deletingCaptureId],
	);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				isEditableTarget(event.target)
			) {
				return;
			}

			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				event.preventDefault();
				dispatch({ type: "SELECT_ADJACENT", key: event.key });
				return;
			}

			if (isCaptureDeleteKey(event.key) && selected) {
				event.preventDefault();
				if (selected.status === "recording") {
					rejectRecordingDelete(selected.id);
					return;
				}
				if (deletingCaptureId) {
					return;
				}
				void deleteSelectedCapture(selected);
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		deletingCaptureId,
		selected,
		deleteSelectedCapture,
		rejectRecordingDelete,
	]);

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
			setMessage(t("noSavedData"));
			return;
		}

		if (!window.showSaveFilePicker) {
			setMessage(t("streamingSaveUnsupported"));
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

	return (
		<main className="flex min-h-screen flex-col bg-base-100 text-base-content">
			<header className="border-base-300 border-b bg-base-200">
				<div className="mx-auto max-w-6xl px-6 py-4">
					<h1 className="font-semibold text-xl">{t("capturesTitle")}</h1>
				</div>
			</header>

			<div className="mx-auto grid w-full max-w-6xl gap-5 px-6 py-6 md:min-h-0 md:flex-1 md:grid-cols-[320px_1fr] md:items-start">
				<aside className="space-y-2 md:flex md:h-full md:min-h-0 md:flex-col">
					{loadError ? (
						<CaptureAlert tone="error">
							<span>
								{t("historyLoadFailed")}
								<button
									className="btn btn-link btn-sm px-1"
									type="button"
									onClick={reload}
								>
									{t("retry")}
								</button>
							</span>
						</CaptureAlert>
					) : null}
					{captures.length === 0 ? (
						<CaptureAlert tone="info">{t("noCaptures")}</CaptureAlert>
					) : null}
					<div className="space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:px-1">
						{captures.map((capture) => (
							<button
								aria-current={capture.id === selected?.id ? "true" : undefined}
								className={`w-full scroll-m-4 rounded-box border p-3 text-left ${
									capture.id === selected?.id
										? "border-primary bg-primary/10"
										: "border-base-300 bg-base-200"
								} ${
									capture.id === rejectedDeleteCaptureId
										? "capture-delete-rejected"
										: ""
								}`}
								key={capture.id}
								ref={
									capture.id === selectedCaptureId
										? selectedCaptureRef
										: undefined
								}
								type="button"
								onAnimationEnd={() => {
									if (capture.id === rejectedDeleteCaptureId) {
										setRejectedDeleteCaptureId(null);
									}
								}}
								onClick={() =>
									dispatch({ type: "SELECT", captureId: capture.id })
								}
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
									{formatDuration(capture.elapsedMs)}
								</p>
							</button>
						))}
					</div>
				</aside>

				<section className="rounded-box border border-base-300 bg-base-200 p-5 md:sticky md:top-6">
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
							{t("selectCapture")}
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

export default App;
