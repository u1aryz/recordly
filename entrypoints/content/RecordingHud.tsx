import type { JSX, PointerEvent as ReactPointerEvent } from "react";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import type { HudPosition } from "@/shared/settings";
import { formatDuration } from "@/shared/video";
import { t } from "@/utils/i18n";
import {
	clampHudPosition,
	HUD_MARGIN_PX,
	type HudRow,
	type HudStore,
	type HudTone,
} from "./hud-store";

type RecordingHudProps = {
	store: HudStore;
	onOpen: (captureId: string) => void;
	onStop: (captureId: string) => void;
	onPositionChange?: (position: HudPosition) => void | Promise<void>;
};

type DragState = {
	pointerId: number;
	offsetX: number;
	offsetY: number;
};

function getViewportSize(): { width: number; height: number } {
	return { width: window.innerWidth, height: window.innerHeight };
}

export function RecordingHud({
	store,
	onOpen,
	onStop,
	onPositionChange,
}: RecordingHudProps): JSX.Element | null {
	const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
	const panelRef = useRef<HTMLElement>(null);
	const dragStateRef = useRef<DragState | null>(null);

	// Right after the position is restored/changed, re-clamp it using the actual rendered panel size.
	useLayoutEffect(() => {
		const position = state.position;
		const panel = panelRef.current;
		if (!position || !panel) {
			return;
		}
		const clamped = clampHudPosition(
			position.left,
			position.top,
			panel.getBoundingClientRect(),
			getViewportSize(),
		);
		if (clamped.left !== position.left || clamped.top !== position.top) {
			store.setPosition(clamped);
		}
	}, [state.position, store]);

	useEffect(() => {
		function handleResize(): void {
			const position = store.getSnapshot().position;
			const panel = panelRef.current;
			if (!position || !panel) {
				return;
			}
			store.setPosition(
				clampHudPosition(
					position.left,
					position.top,
					panel.getBoundingClientRect(),
					getViewportSize(),
				),
			);
		}
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [store]);

	function beginDrag(event: ReactPointerEvent<HTMLElement>): void {
		if (event.button !== 0 || !panelRef.current) {
			return;
		}
		const rect = panelRef.current.getBoundingClientRect();
		dragStateRef.current = {
			pointerId: event.pointerId,
			offsetX: event.clientX - rect.left,
			offsetY: event.clientY - rect.top,
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	}

	function moveDrag(event: ReactPointerEvent<HTMLElement>): void {
		const dragState = dragStateRef.current;
		if (
			!dragState ||
			event.pointerId !== dragState.pointerId ||
			!panelRef.current
		) {
			return;
		}
		store.setPosition(
			clampHudPosition(
				event.clientX - dragState.offsetX,
				event.clientY - dragState.offsetY,
				panelRef.current.getBoundingClientRect(),
				getViewportSize(),
			),
		);
	}

	function endDrag(event: ReactPointerEvent<HTMLElement>): void {
		const dragState = dragStateRef.current;
		if (!dragState || event.pointerId !== dragState.pointerId) {
			return;
		}
		dragStateRef.current = null;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		const position = store.getSnapshot().position;
		if (position) {
			void onPositionChange?.(position);
		}
	}

	if (state.rows.length === 0) {
		return null;
	}

	return (
		<section
			ref={panelRef}
			aria-label={t("recordingStatus")}
			className="pointer-events-auto fixed w-[min(390px,calc(100vw-32px))] overflow-hidden rounded-lg border border-base-300 bg-base-100 font-sans text-base-content text-sm shadow-2xl"
			style={
				state.position
					? { left: state.position.left, top: state.position.top }
					: { right: HUD_MARGIN_PX, bottom: HUD_MARGIN_PX }
			}
		>
			<header
				className="flex cursor-move touch-none select-none items-center justify-between gap-3 border-base-300 border-b bg-base-200 px-3 py-2.5"
				title={t("moveRecordingHud")}
				onPointerCancel={endDrag}
				onPointerDown={beginDrag}
				onPointerMove={moveDrag}
				onPointerUp={endDrag}
			>
				<span className="flex items-center gap-2 font-bold">
					<span aria-hidden="true" className="inline-grid *:[grid-area:1/1]">
						<span className="status status-error animate-ping" />
						<span className="status status-error" />
					</span>
					{t("recordingStatus")}
				</span>
				<span className="text-base-content/60 text-xs">
					{t("recordingCount", String(state.recordingCount))}
				</span>
			</header>
			<div className="max-h-[50vh] overflow-y-auto overscroll-contain">
				{state.rows.map((row) => (
					<RecordingHudRow
						key={row.id}
						onOpen={onOpen}
						onStop={onStop}
						row={row}
					/>
				))}
			</div>
		</section>
	);
}

type RecordingHudRowProps = {
	row: HudRow;
	onOpen: (captureId: string) => void;
	onStop: (captureId: string) => void;
};

const TONE_ACCENT_CLASS: Record<HudTone, string> = {
	success: "shadow-[inset_3px_0_0_0] shadow-success",
	warning: "shadow-[inset_3px_0_0_0] shadow-warning",
	error: "shadow-[inset_3px_0_0_0] shadow-error",
};

function getDetailText(row: HudRow): string {
	switch (row.detail.kind) {
		case "recording":
			return t("recordingToDestination");
		case "part":
			return t("recordingPart", String(row.partCount));
		case "notice":
			return row.detail.message;
		case "finalizing":
			return t("finalizingMp4");
		case "result":
			return row.detail.message;
		default:
			return "";
	}
}

function RecordingHudRow({
	row,
	onOpen,
	onStop,
}: RecordingHudRowProps): JSX.Element {
	const rowRef = useRef<HTMLElement>(null);

	useEffect(() => {
		if (row.highlighted) {
			rowRef.current?.scrollIntoView?.({ block: "nearest" });
		}
	}, [row.highlighted]);

	const toneClass =
		row.detail.kind === "result" ? TONE_ACCENT_CLASS[row.detail.tone] : "";

	return (
		<article
			ref={rowRef}
			className={`grid grid-cols-[64px_minmax(0,1fr)] gap-2.5 border-base-300 border-b p-3 transition-colors last:border-b-0 ${
				row.highlighted
					? "bg-warning/10 shadow-[inset_3px_0_0_0] shadow-warning"
					: toneClass
			}`}
			data-capture-id={row.id}
			data-highlighted={row.highlighted || undefined}
			data-tone={row.detail.kind === "result" ? row.detail.tone : undefined}
		>
			<div className="h-10 w-16 overflow-hidden rounded border border-base-300 bg-base-200">
				{row.thumbnailDataUrl ? (
					<img
						alt=""
						className="h-full w-full object-cover"
						src={row.thumbnailDataUrl}
					/>
				) : (
					<span className="flex h-full w-full items-center justify-center text-[10px] text-base-content/45">
						video
					</span>
				)}
			</div>
			<div className="min-w-0">
				<div className="flex items-center justify-between gap-2.5">
					<span className="truncate font-bold">{row.title}</span>
					<span className="flex-none text-primary tabular-nums">
						{row.detail.kind === "result" ? "" : formatDuration(row.elapsedMs)}
					</span>
				</div>
				<p className="mt-0.5 text-[11px] text-base-content/60">
					{row.width} x {row.height}
				</p>
				<p className="mt-1 text-base-content/75 text-xs">
					{getDetailText(row)}
				</p>
				{row.detail.kind === "result" ? null : (
					<div className="mt-2 flex flex-wrap gap-1.5">
						<button
							className="btn btn-primary btn-xs"
							onClick={() => onOpen(row.id)}
							type="button"
						>
							{t("openStatus")}
						</button>
						<button
							className="btn btn-warning btn-xs"
							disabled={row.stopping}
							onClick={() => onStop(row.id)}
							type="button"
						>
							{t("stopAndSave")}
						</button>
					</div>
				)}
			</div>
		</article>
	);
}
