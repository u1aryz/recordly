import type { JSX } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	describeVideo,
	findVideoFromPoint,
	isVideoConnected,
} from "@/shared/video";
import { t } from "@/utils/i18n";

export type VideoPickerStartResult =
	| { ok: true }
	| { ok: false; cancelled?: boolean; reason?: string };

type VideoPickerOverlayProps = {
	onStart: (video: HTMLVideoElement) => Promise<VideoPickerStartResult>;
	onClose: () => void;
	/** jsdom doesn't implement elementsFromPoint, so allow overriding it in tests. */
	findVideoAt?: (x: number, y: number) => HTMLVideoElement | null;
};

type VideoRect = { left: number; top: number; width: number; height: number };
type ToolbarPosition = { left: number; top: number };

function toVideoRect(domRect: DOMRect): VideoRect {
	return {
		left: domRect.left,
		top: domRect.top,
		width: domRect.width,
		height: domRect.height,
	};
}

export function VideoPickerOverlay({
	onStart,
	onClose,
	findVideoAt = findVideoFromPoint,
}: VideoPickerOverlayProps): JSX.Element {
	const [currentVideo, setCurrentVideo] = useState<HTMLVideoElement | null>(
		null,
	);
	const [rect, setRect] = useState<VideoRect | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [toolbarPosition, setToolbarPosition] =
		useState<ToolbarPosition | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const currentVideoRef = useRef<HTMLVideoElement | null>(null);
	const onCloseRef = useRef(onClose);
	const findVideoAtRef = useRef(findVideoAt);
	onCloseRef.current = onClose;
	findVideoAtRef.current = findVideoAt;

	const selectVideo = useCallback((video: HTMLVideoElement): void => {
		currentVideoRef.current = video;
		setCurrentVideo(video);
		setMessage(null);
		setRect(toVideoRect(video.getBoundingClientRect()));
	}, []);

	const clearSelection = useCallback((): void => {
		currentVideoRef.current = null;
		setCurrentVideo(null);
		setRect(null);
		setMessage(null);
	}, []);

	const refreshRect = useCallback((): void => {
		const video = currentVideoRef.current;
		if (!video) {
			return;
		}
		if (!isVideoConnected(video)) {
			clearSelection();
			return;
		}
		setRect(toVideoRect(video.getBoundingClientRect()));
	}, [clearSelection]);

	useEffect(() => {
		function onPointerMove(event: PointerEvent): void {
			if (rootRef.current && event.composedPath().includes(rootRef.current)) {
				return;
			}
			const video = findVideoAtRef.current(event.clientX, event.clientY);
			if (video && video !== currentVideoRef.current) {
				selectVideo(video);
			}
		}
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
			}
		}
		window.addEventListener("pointermove", onPointerMove, true);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", refreshRect, true);
		window.addEventListener("resize", refreshRect, true);
		return () => {
			window.removeEventListener("pointermove", onPointerMove, true);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("scroll", refreshRect, true);
			window.removeEventListener("resize", refreshRect, true);
		};
	}, [refreshRect, selectVideo]);

	useEffect(() => {
		if (!currentVideo) {
			return;
		}
		// Watch for the selected video being removed from the DOM without a
		// scroll/resize event (e.g. an SPA re-render).
		const observer = new MutationObserver(() => {
			if (!isVideoConnected(currentVideo)) {
				clearSelection();
			}
		});
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, [currentVideo, clearSelection]);

	useLayoutEffect(() => {
		if (!rect || !toolbarRef.current) {
			setToolbarPosition(null);
			return;
		}
		const toolbarWidth = toolbarRef.current.offsetWidth;
		const toolbarHeight = toolbarRef.current.offsetHeight;
		setToolbarPosition({
			left: Math.max(
				8,
				Math.min(rect.left, window.innerWidth - toolbarWidth - 8),
			),
			top: Math.max(8, rect.top - toolbarHeight - 8),
		});
	}, [rect]);

	async function handleStart(): Promise<void> {
		const video = currentVideo;
		if (!video) {
			return;
		}
		setPending(true);
		setMessage(null);
		const result = await onStart(video);
		setPending(false);
		if (result.ok) {
			onClose();
			return;
		}
		if (result.cancelled) {
			return;
		}
		setMessage(result.reason ?? t("recordingStartFailed"));
	}

	const info = currentVideo ? describeVideo(currentVideo) : null;

	return (
		<div className="pointer-events-none fixed inset-0" ref={rootRef}>
			<div className="pointer-events-none fixed top-3 left-1/2 max-w-[calc(100vw-24px)] -translate-x-1/2 whitespace-nowrap rounded-lg border border-base-300 bg-base-100 px-3.5 py-2.5 font-semibold text-base-content text-xs shadow-2xl">
				{t("pickerInstructions")}
				<span className="text-base-content/60">
					{"　"}
					{t("pickerCancelHint")}
				</span>
			</div>
			{currentVideo && rect && info && (
				<>
					<div
						className="pointer-events-none fixed border-2 border-base-100 shadow-[0_0_0_1px_var(--color-base-100),0_0_0_4px_var(--color-primary)]"
						style={{
							left: rect.left,
							top: rect.top,
							width: rect.width,
							height: rect.height,
						}}
					/>
					<div
						className="pointer-events-auto fixed flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 text-base-content text-xs shadow-2xl"
						ref={toolbarRef}
						style={
							toolbarPosition
								? { left: toolbarPosition.left, top: toolbarPosition.top }
								: { left: rect.left, top: Math.max(8, rect.top - 8) }
						}
					>
						<div className="flex flex-wrap items-center gap-2 p-2">
							<span className="badge badge-primary badge-soft badge-sm font-bold">
								{t("videoElementLabel")}
							</span>
							<span className="text-base-content/70">
								{info.width || "?"} x {info.height || "?"} /{" "}
								{info.paused ? t("paused") : t("playing")} /{" "}
								{info.muted ? t("muted") : t("audioAvailable")}
							</span>
							<button
								className="btn btn-primary btn-xs"
								disabled={pending}
								onClick={() => void handleStart()}
								type="button"
							>
								{t("chooseFolderAndRecord")}
							</button>
							<button
								className="btn btn-ghost btn-xs"
								onClick={onClose}
								type="button"
							>
								{t("cancel")}
							</button>
						</div>
						{message && (
							<div className="border-base-300 border-t bg-base-200 p-2 text-warning">
								{message}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}
