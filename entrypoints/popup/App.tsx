import {
	ArrowPathIcon,
	ClockIcon,
	CursorArrowRaysIcon,
	FilmIcon,
} from "@heroicons/react/24/outline";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { continueOnResolutionChange } from "@/shared/settings";
import { listCaptures } from "@/shared/storage";
import type { VideoDescriptor } from "@/shared/types";
import { formatDuration } from "@/shared/video";
import { t } from "@/utils/i18n";

type PopupState = {
	loading: boolean;
	error?: string;
	videos: VideoDescriptor[];
	recordingCount: number;
};

async function getActiveTabId(): Promise<number> {
	const [tab] = await browser.tabs.query({
		active: true,
		currentWindow: true,
	});
	if (tab?.id == null) {
		throw new Error(t("activeTabUnavailable"));
	}
	return tab.id;
}

function App(): JSX.Element {
	const [state, setState] = useState<PopupState>({
		loading: true,
		videos: [],
		recordingCount: 0,
	});
	const canStartPicker =
		!state.loading && state.videos.some((video) => video.canCapture);
	const historyLabel =
		state.recordingCount > 0
			? t("recordingCount", String(state.recordingCount))
			: t("history");
	const [
		continueOnResolutionChangeEnabled,
		setContinueOnResolutionChangeEnabled,
	] = useState(true);

	const refreshVideos = useCallback(async () => {
		setState((current) => ({ ...current, loading: true, error: undefined }));
		try {
			const tabId = await getActiveTabId();
			const response = await browser.tabs.sendMessage(tabId, {
				type: "LIST_VIDEOS",
			});
			const captures = await listCaptures();
			setState({
				loading: false,
				videos: response?.videos ?? [],
				recordingCount: captures.filter(
					(capture) => capture.status === "recording",
				).length,
			});
		} catch {
			setState({
				loading: false,
				videos: [],
				recordingCount: 0,
				error: t("pageUnavailable"),
			});
		}
	}, []);

	useEffect(() => {
		void refreshVideos();
	}, [refreshVideos]);

	useEffect(() => {
		void continueOnResolutionChange
			.getValue()
			.then(setContinueOnResolutionChangeEnabled);
	}, []);

	function toggleContinueOnResolutionChange(enabled: boolean) {
		setContinueOnResolutionChangeEnabled(enabled);
		void continueOnResolutionChange.setValue(enabled);
	}

	async function startPicker() {
		const tabId = await getActiveTabId();
		await browser.tabs.sendMessage(tabId, { type: "START_PICKER" });
		window.close();
	}

	async function openCaptures() {
		await browser.runtime.sendMessage({ type: "OPEN_CAPTURES" });
		window.close();
	}

	return (
		<main className="w-[400px] overflow-hidden bg-base-100 text-base-content">
			<header className="border-base-300 border-b bg-base-200 px-5 py-4">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0 space-y-0.5">
						<h1 className="truncate font-bold text-lg tracking-tight">
							Recordly
						</h1>
						<p className="truncate text-base-content/65 text-xs">
							{t("popupDescription")}
						</p>
					</div>
					<button
						className="btn btn-ghost btn-sm shrink-0"
						type="button"
						onClick={openCaptures}
					>
						<ClockIcon className="h-4 w-4" />
						{historyLabel}
					</button>
				</div>
			</header>

			<section className="space-y-5 p-5">
				<div className="card card-border bg-base-200 shadow-sm">
					<div className="card-body gap-4 p-4">
						<button
							className="btn btn-primary btn-block shadow-sm"
							disabled={!canStartPicker}
							type="button"
							onClick={startPicker}
						>
							<CursorArrowRaysIcon className="h-5 w-5" />
							{t("selectVideoOnPage")}
						</button>

						<ol className="grid grid-cols-3 divide-x divide-base-300 text-center text-base-content/65 text-xs">
							<li className="flex flex-col items-center gap-1.5 px-1">
								<span className="badge badge-soft badge-sm">1</span>
								<p className="leading-tight">{t("stepSelectVideo")}</p>
							</li>
							<li className="flex flex-col items-center gap-1.5 px-1">
								<span className="badge badge-soft badge-sm">2</span>
								<p className="leading-tight">{t("stepChooseDestination")}</p>
							</li>
							<li className="flex flex-col items-center gap-1.5 px-1">
								<span className="badge badge-soft badge-sm">3</span>
								<p className="leading-tight">{t("stepStartRecording")}</p>
							</li>
						</ol>

						<label className="flex items-start justify-between gap-3 border-base-300 border-t pt-3.5">
							<span className="min-w-0">
								<span className="block font-medium text-sm">
									{t("settingContinueOnResolutionChange")}
								</span>
								<span className="block text-base-content/60 text-xs">
									{t("settingContinueOnResolutionChangeDescription")}
								</span>
							</span>
							<input
								checked={continueOnResolutionChangeEnabled}
								className="toggle toggle-primary shrink-0"
								type="checkbox"
								onChange={(event) =>
									toggleContinueOnResolutionChange(event.target.checked)
								}
							/>
						</label>
					</div>
				</div>

				<div className="flex items-center justify-between gap-3">
					<h2 className="flex items-center gap-2 font-semibold text-sm">
						<span className="grid size-7 place-items-center rounded-field bg-base-200">
							<FilmIcon className="h-4 w-4 text-base-content/55" />
						</span>
						{t("detectedVideos")}
					</h2>
					<button
						className="btn btn-ghost btn-xs w-16"
						type="button"
						aria-busy={state.loading}
						disabled={state.loading}
						onClick={refreshVideos}
					>
						{state.loading ? (
							<span className="loading loading-spinner loading-xs" />
						) : (
							<ArrowPathIcon className="h-3.5 w-3.5" />
						)}
						{t("refresh")}
					</button>
				</div>

				{state.error ? (
					<div className="alert alert-soft alert-warning text-xs">
						{state.error}
					</div>
				) : null}

				{!state.loading && state.videos.length === 0 && !state.error ? (
					<div className="alert text-xs">{t("noVideosDetected")}</div>
				) : null}

				<ul className="list max-h-[360px] gap-2 overflow-y-auto pr-1">
					{state.videos.map((video, index) => (
						<li
							className="block list-row rounded-box border border-base-300 bg-base-100 p-3.5 shadow-sm"
							key={video.id}
						>
							<div className="min-w-0">
								<div className="flex min-w-0 items-start justify-between gap-3">
									<p className="truncate font-medium text-sm">
										{video.title || `Video ${index + 1}`}
									</p>
									<span
										className={`badge badge-soft badge-xs shrink-0 ${
											video.paused ? "" : "badge-success"
										}`}
									>
										{video.paused ? t("paused") : t("playing")}
									</span>
								</div>
								<div className="mt-2.5 flex flex-wrap gap-1.5">
									<span className="badge badge-soft badge-primary badge-sm font-medium">
										{video.width || "?"} x {video.height || "?"}
									</span>
									<span className="badge badge-soft badge-sm">
										{video.duration
											? formatDuration(video.duration * 1000)
											: t("liveOrUnknown")}
									</span>
								</div>
								{video.reason ? (
									<p className="mt-2 text-error text-xs">{video.reason}</p>
								) : null}
							</div>
						</li>
					))}
				</ul>
			</section>
		</main>
	);
}

export default App;
