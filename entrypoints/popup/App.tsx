import {
	ArrowPathIcon,
	ClockIcon,
	CursorArrowRaysIcon,
	FilmIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { listCaptures } from "@/shared/storage";
import type { VideoDescriptor } from "@/shared/types";
import { formatDuration } from "@/shared/video";

type PopupState = {
	loading: boolean;
	error?: string;
	videos: VideoDescriptor[];
	recordingCount: number;
};

function App() {
	const [state, setState] = useState<PopupState>({
		loading: true,
		videos: [],
		recordingCount: 0,
	});
	const canStartPicker =
		!state.loading && state.videos.some((video) => video.canCapture);
	const historyLabel =
		state.recordingCount > 0 ? `録画中 ${state.recordingCount}件` : "履歴";

	const getActiveTab = useCallback(async () => {
		const [tab] = await browser.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (!tab?.id) {
			throw new Error("現在のタブを取得できませんでした");
		}
		return tab;
	}, []);

	const refreshVideos = useCallback(async () => {
		setState((current) => ({ ...current, loading: true, error: undefined }));
		try {
			const tab = await getActiveTab();
			const response = await browser.tabs.sendMessage(tab.id as number, {
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
				error:
					"このページでは拡張を実行できないか、動画がまだ検出されていません。",
			});
		}
	}, [getActiveTab]);

	useEffect(() => {
		void refreshVideos();
	}, [refreshVideos]);

	async function startPicker() {
		const tab = await getActiveTab();
		await browser.tabs.sendMessage(tab.id as number, { type: "START_PICKER" });
		window.close();
	}

	async function openCaptures() {
		await browser.runtime.sendMessage({ type: "OPEN_CAPTURES" });
		window.close();
	}

	return (
		<main className="w-[400px] bg-base-100 text-base-content">
			<header className="border-base-300 border-b bg-base-200 px-4 py-3">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<h1 className="truncate font-semibold text-base">Recordly</h1>
						<p className="text-base-content/65 text-xs">
							ページ上の video を選んで MP4 キャプチャします。
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

			<section className="space-y-4 p-4">
				<button
					className="btn btn-primary btn-block"
					disabled={!canStartPicker}
					type="button"
					onClick={startPicker}
				>
					<CursorArrowRaysIcon className="h-5 w-5" />
					ページ上で録画する動画を選ぶ
				</button>

				<ol className="grid grid-cols-3 gap-2 text-center text-base-content/65 text-xs">
					<li>
						<span className="badge badge-sm mb-1">1</span>
						<p>動画を選択</p>
					</li>
					<li>
						<span className="badge badge-sm mb-1">2</span>
						<p>保存先を指定</p>
					</li>
					<li>
						<span className="badge badge-sm mb-1">3</span>
						<p>録画開始</p>
					</li>
				</ol>

				<div className="flex items-center justify-between border-base-300 border-b pb-2">
					<h2 className="flex items-center gap-2 font-medium text-sm">
						<FilmIcon className="h-4 w-4 text-base-content/55" />
						検出済み動画
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
						更新
					</button>
				</div>

				{state.error ? (
					<div className="alert alert-soft alert-warning text-xs">
						{state.error}
					</div>
				) : null}

				{!state.loading && state.videos.length === 0 && !state.error ? (
					<div className="alert text-xs">
						動画を検出できませんでした。動画を再生してから更新してください。
					</div>
				) : null}

				<ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
					{state.videos.map((video, index) => (
						<li
							className="rounded-box border border-base-300 bg-base-100 p-3 shadow-sm"
							key={video.id}
						>
							<div className="min-w-0">
								<div className="flex min-w-0 items-center gap-2">
									<p className="truncate font-medium text-sm">
										{video.title || `Video ${index + 1}`}
									</p>
									<span
										className={`badge badge-xs shrink-0 ${
											video.paused ? "badge-outline" : "badge-success"
										}`}
									>
										{video.paused ? "一時停止" : "再生中"}
									</span>
								</div>
								<div className="mt-2 flex flex-wrap gap-1.5">
									<span className="badge badge-primary badge-sm badge-outline bg-primary/10 font-medium">
										{video.width || "?"} x {video.height || "?"}
									</span>
									<span className="badge badge-sm border-base-300 bg-base-200 text-base-content/75">
										{video.duration
											? formatDuration(video.duration * 1000)
											: "live/unknown"}
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
