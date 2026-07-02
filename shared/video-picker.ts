import { t } from "@/utils/i18n";
import { INJECTED_UI_THEME_CSS } from "./injected-ui-theme";
import { describeVideo, findVideoFromPoint } from "./video";

export type VideoPickerStartResult =
	| { ok: true }
	| { ok: false; cancelled?: boolean; reason?: string };

export type VideoPickerOptions = {
	onStart: (video: HTMLVideoElement) => Promise<VideoPickerStartResult>;
	/** jsdom は elementsFromPoint 未実装のため、テストでは差し替え可能にする。 */
	findVideoAt?: (x: number, y: number) => HTMLVideoElement | null;
};

export type VideoPicker = {
	start: () => void;
	destroy: () => void;
};

export function createVideoPicker(options: VideoPickerOptions): VideoPicker {
	const findVideoAt = options.findVideoAt ?? findVideoFromPoint;
	let picking = false;
	let currentVideo: HTMLVideoElement | null = null;
	const host = document.createElement("div");
	host.dataset.recordlyVideoPicker = "";
	host.style.position = "fixed";
	host.style.inset = "0";
	host.style.pointerEvents = "none";
	host.style.zIndex = "2147483647";
	host.style.display = "none";
	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>
			${INJECTED_UI_THEME_CSS}
			.frame {
				position: fixed;
				border: 2px solid var(--base-100);
				background: color-mix(in oklch, var(--primary) 10%, transparent);
				box-shadow:
					0 0 0 1px color-mix(in oklch, var(--base-100) 65%, transparent),
					0 0 0 4px color-mix(in oklch, var(--primary) 18%, transparent);
				pointer-events: none;
			}
			.toolbar {
				position: fixed;
				display: flex;
				flex-direction: column;
				max-width: calc(100vw - 16px);
				overflow: hidden;
				border: 1px solid var(--base-300);
				border-radius: 8px;
				background: var(--base-100);
				color: var(--base-content);
				font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				box-shadow: 0 16px 40px color-mix(in oklch, black 42%, transparent);
				pointer-events: auto;
			}
			.toolbar-main {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 8px;
			}
			.instructions {
				position: fixed;
				top: 12px;
				left: 50%;
				transform: translateX(-50%);
				max-width: calc(100vw - 24px);
				padding: 9px 13px;
				border: 1px solid var(--base-300);
				border-radius: 8px;
				background: var(--base-100);
				color: var(--base-content);
				font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif;
				box-shadow: 0 12px 32px color-mix(in oklch, black 38%, transparent);
				pointer-events: none;
				white-space: nowrap;
			}
			.instructions span { color: color-mix(in oklch, var(--base-content) 62%, transparent); }
			.label {
				padding: 3px 6px;
				border: 1px solid color-mix(in oklch, var(--primary) 45%, transparent);
				border-radius: 4px;
				background: color-mix(in oklch, var(--primary) 12%, transparent);
				color: var(--primary);
				font-weight: 700;
				letter-spacing: 0.04em;
				white-space: nowrap;
			}
			.meta {
				color: color-mix(in oklch, var(--base-content) 72%, transparent);
				white-space: nowrap;
			}
			.message {
				padding: 8px 10px;
				border-top: 1px solid var(--base-300);
				background: var(--base-200);
				color: var(--warning);
			}
			button {
				min-height: 30px;
				border: 1px solid transparent;
				border-radius: 8px;
				padding: 5px 10px;
				font: inherit;
				font-weight: 700;
				cursor: pointer;
			}
			button:disabled { cursor: wait; opacity: 0.65; }
			button:focus-visible {
				outline: 2px solid var(--primary);
				outline-offset: 2px;
			}
			.start {
				background: var(--primary);
				color: var(--primary-content);
			}
			.start:hover:not(:disabled) {
				background: color-mix(in oklch, var(--primary) 88%, white);
			}
			.cancel {
				border-color: var(--base-300);
				background: var(--base-200);
				color: color-mix(in oklch, var(--base-content) 78%, transparent);
			}
			.cancel:hover {
				background: var(--base-300);
				color: var(--base-content);
			}
			@media (max-width: 560px) {
				.toolbar-main { flex-wrap: wrap; }
				.meta {
					order: 3;
					width: 100%;
				}
				.instructions {
					text-align: center;
					white-space: normal;
				}
			}
		</style>
		<div class="instructions" hidden>
			${t("pickerInstructions")}　<span>${t("pickerCancelHint")}</span>
		</div>
		<div class="frame" hidden></div>
		<div class="toolbar" hidden>
			<div class="toolbar-main">
				<span class="label">${t("videoElementLabel")}</span>
				<span class="meta"></span>
				<button class="start" type="button">${t("chooseFolderAndRecord")}</button>
				<button class="cancel" type="button">${t("cancel")}</button>
			</div>
			<div class="message" hidden></div>
		</div>
	`;

	const instructions = shadow.querySelector<HTMLElement>(".instructions");
	const frame = shadow.querySelector<HTMLElement>(".frame");
	const toolbar = shadow.querySelector<HTMLElement>(".toolbar");
	const meta = shadow.querySelector<HTMLElement>(".meta");
	const message = shadow.querySelector<HTMLElement>(".message");
	const startButton = shadow.querySelector<HTMLButtonElement>(".start");
	const cancelButton = shadow.querySelector<HTMLButtonElement>(".cancel");

	function mount(): void {
		if (!host.isConnected) {
			document.documentElement.append(host);
		}
		host.style.display = "block";
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", refreshOverlay, true);
		window.addEventListener("resize", refreshOverlay, true);
	}

	function start(): void {
		if (picking) {
			return;
		}
		picking = true;
		currentVideo = null;
		mount();
		window.addEventListener("pointermove", onPointerMove, true);
		if (instructions) {
			instructions.hidden = false;
		}
		refreshOverlay();
	}

	function stop(): void {
		picking = false;
		currentVideo = null;
		host.style.display = "none";
		instructions?.setAttribute("hidden", "");
		frame?.setAttribute("hidden", "");
		toolbar?.setAttribute("hidden", "");
		message?.setAttribute("hidden", "");
		window.removeEventListener("pointermove", onPointerMove, true);
		window.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", refreshOverlay, true);
		window.removeEventListener("resize", refreshOverlay, true);
		host.remove();
	}

	function onPointerMove(event: PointerEvent): void {
		if (!picking) {
			return;
		}
		if (event.composedPath().includes(host)) {
			return;
		}
		const video = findVideoAt(event.clientX, event.clientY);
		if (video !== currentVideo) {
			currentVideo = video;
			refreshOverlay();
		}
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			stop();
		}
	}

	function refreshOverlay(): void {
		if (!currentVideo || !frame || !toolbar || !meta) {
			frame?.setAttribute("hidden", "");
			toolbar?.setAttribute("hidden", "");
			if (instructions) {
				instructions.hidden = false;
			}
			return;
		}
		if (!document.contains(currentVideo)) {
			stop();
			return;
		}
		if (instructions) {
			instructions.hidden = true;
		}
		const rect = currentVideo.getBoundingClientRect();
		const info = describeVideo(currentVideo);
		frame.hidden = false;
		frame.style.left = `${rect.left}px`;
		frame.style.top = `${rect.top}px`;
		frame.style.width = `${rect.width}px`;
		frame.style.height = `${rect.height}px`;
		toolbar.hidden = false;
		meta.textContent = `${info.width || "?"} x ${info.height || "?"} / ${
			info.paused ? t("paused") : t("playing")
		} / ${info.muted ? t("muted") : t("audioAvailable")}`;
		const toolbarWidth = toolbar.offsetWidth;
		const toolbarHeight = toolbar.offsetHeight;
		toolbar.style.left = `${Math.max(
			8,
			Math.min(rect.left, window.innerWidth - toolbarWidth - 8),
		)}px`;
		toolbar.style.top = `${Math.max(8, rect.top - toolbarHeight - 8)}px`;
	}

	startButton?.addEventListener("click", async () => {
		if (!currentVideo || !startButton || !message) {
			return;
		}
		startButton.disabled = true;
		message.hidden = true;
		const result = await options.onStart(currentVideo);
		startButton.disabled = false;
		if (result.ok) {
			stop();
			return;
		}
		if (result.cancelled) {
			return;
		}
		message.textContent = result.reason ?? t("recordingStartFailed");
		message.hidden = false;
	});
	cancelButton?.addEventListener("click", stop);

	return { start, destroy: stop };
}
