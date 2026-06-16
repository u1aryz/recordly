import { useCallback, useEffect, useState } from "react";
import type { VideoDescriptor } from "@/shared/types";
import { formatDuration } from "@/shared/video";

type PopupState = {
	loading: boolean;
	error?: string;
	videos: VideoDescriptor[];
};

function App() {
	const [state, setState] = useState<PopupState>({ loading: true, videos: [] });

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
			setState({ loading: false, videos: response?.videos ?? [] });
		} catch {
			setState({
				loading: false,
				videos: [],
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

	async function startCapture(videoId: string) {
		const tab = await getActiveTab();
		await browser.tabs.sendMessage(tab.id as number, {
			type: "START_CAPTURE",
			videoId,
		});
		window.close();
	}

	async function openCaptures() {
		await browser.runtime.sendMessage({ type: "OPEN_CAPTURES" });
		window.close();
	}

	return (
		<main className="w-[380px] bg-base-100 p-4 text-base-content">
			<header className="mb-4 flex items-start justify-between gap-3">
				<div>
					<h1 className="font-semibold text-lg">Video Capture Picker</h1>
					<p className="text-base-content/65 text-xs">
						ページ上の video を選んで MP4 キャプチャします。
					</p>
				</div>
				<button
					className="btn btn-ghost btn-sm"
					type="button"
					onClick={openCaptures}
				>
					履歴
				</button>
			</header>

			<button
				className="btn btn-primary btn-block"
				type="button"
				onClick={startPicker}
			>
				ページ上で動画を選択
			</button>

			<div className="mt-4 flex items-center justify-between">
				<h2 className="font-medium text-sm">検出済み動画</h2>
				<button
					className="btn btn-ghost btn-xs"
					type="button"
					onClick={refreshVideos}
				>
					更新
				</button>
			</div>

			{state.loading ? (
				<div className="mt-3 flex items-center gap-2 text-sm">
					<span className="loading loading-spinner loading-sm" />
					検出中
				</div>
			) : null}

			{state.error ? (
				<div className="alert alert-soft alert-warning mt-3 text-xs">
					{state.error}
				</div>
			) : null}

			{!state.loading && state.videos.length === 0 && !state.error ? (
				<div className="alert mt-3 text-xs">
					このページでは video タグを検出していません。
				</div>
			) : null}

			<ul className="mt-3 space-y-2">
				{state.videos.map((video, index) => (
					<li
						className="rounded-box border border-base-300 bg-base-200 p-3"
						key={video.id}
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="truncate font-medium text-sm">
									{video.title || `Video ${index + 1}`}
								</p>
								<div className="mt-1 flex flex-wrap gap-1">
									<span className="badge badge-sm">
										{video.width || "?"} x {video.height || "?"}
									</span>
									<span className="badge badge-sm badge-outline">
										{video.duration
											? formatDuration(video.duration * 1000)
											: "live/unknown"}
									</span>
									<span className="badge badge-sm badge-outline">
										{video.paused ? "一時停止" : "再生中"}
									</span>
								</div>
								{video.reason ? (
									<p className="mt-2 text-error text-xs">{video.reason}</p>
								) : null}
							</div>
							<button
								className="btn btn-sm"
								type="button"
								disabled={!video.canCapture}
								onClick={() => startCapture(video.id)}
							>
								開始
							</button>
						</div>
					</li>
				))}
			</ul>
		</main>
	);
}

export default App;
