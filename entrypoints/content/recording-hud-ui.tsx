import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
	createShadowRootUi,
	type ShadowRootContentScriptUi,
} from "wxt/utils/content-script-ui/shadow-root";
import type { HudPosition } from "@/shared/settings";
import type { CaptureMetadata, VideoResolution } from "@/shared/types";
import {
	createHudStore,
	HUD_EXIT_ANIMATION_MS,
	type HudTone,
} from "./hud-store";
import { RecordingHud } from "./RecordingHud";
import { createShadowHostCss, HUD_Z_INDEX } from "./shadow-host-css";

export type RecordingHudManager = {
	add: (metadata: CaptureMetadata) => void;
	update: (captureId: string, elapsedMs: number) => void;
	updatePart: (
		captureId: string,
		partCount: number,
		size: VideoResolution,
	) => void;
	notify: (captureId: string, message: string) => void;
	markStopping: (captureId: string, elapsedMs: number) => void;
	finish: (captureId: string, message: string, tone: HudTone) => void;
	remove: (captureId: string) => void;
	highlight: (captureId: string) => void;
	setPosition: (position: HudPosition | null) => void;
	destroy: () => void;
};

type RecordingHudUiOptions = {
	onOpen: (captureId: string) => void;
	onStop: (captureId: string) => void;
	getPosition?: () => Promise<HudPosition | null>;
	onPositionChange?: (position: HudPosition) => void | Promise<void>;
};

export function createRecordingHudUi(
	ctx: ContentScriptContext,
	options: RecordingHudUiOptions,
): RecordingHudManager {
	const store = createHudStore();
	let destroyed = false;
	let mounted = false;
	let hiding = false;
	let hideTimer: number | undefined;
	let uiPromise: Promise<ShadowRootContentScriptUi<Root>> | undefined;

	void options.getPosition?.().then((position) => {
		if (!destroyed) {
			store.setPosition(position);
		}
	});

	function ensureUi(): Promise<ShadowRootContentScriptUi<Root>> {
		uiPromise ??= createShadowRootUi(ctx, {
			name: "recordly-recording-hud",
			position: "overlay",
			zIndex: HUD_Z_INDEX,
			css: createShadowHostCss(HUD_Z_INDEX),
			onMount(container) {
				const appRoot = document.createElement("div");
				container.append(appRoot);
				const root = createRoot(appRoot);
				root.render(
					<StrictMode>
						<RecordingHud
							onOpen={options.onOpen}
							onPositionChange={options.onPositionChange}
							onStop={options.onStop}
							store={store}
						/>
					</StrictMode>,
				);
				return root;
			},
			onRemove(root) {
				root?.unmount();
			},
		});
		return uiPromise;
	}

	function prefersReducedMotion(): boolean {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	function clearHideTimer(): void {
		hiding = false;
		if (hideTimer !== undefined) {
			window.clearTimeout(hideTimer);
			hideTimer = undefined;
		}
	}

	function cancelHide(): void {
		if (!hiding) {
			return;
		}
		clearHideTimer();
		store.setClosing(false);
	}

	const unsubscribe = store.subscribe(() => {
		const hasRows = store.getSnapshot().rows.length > 0;
		if (hasRows) {
			// A new recording may start mid-exit-animation; keep the panel alive.
			cancelHide();
			if (!mounted) {
				mounted = true;
				void ensureUi().then((ui) => {
					if (store.getSnapshot().rows.length > 0) {
						ui.mount();
					} else {
						mounted = false;
					}
				});
			}
			return;
		}
		if (mounted && !hiding) {
			if (prefersReducedMotion()) {
				mounted = false;
				void ensureUi().then((ui) => ui.remove());
				return;
			}
			// Set the guard before setClosing: emit() re-enters this listener synchronously.
			hiding = true;
			store.setClosing(true);
			hideTimer = window.setTimeout(() => {
				hideTimer = undefined;
				hiding = false;
				if (store.getSnapshot().rows.length === 0) {
					mounted = false;
					store.setClosing(false);
					void ensureUi().then((ui) => ui.remove());
				}
			}, HUD_EXIT_ANIMATION_MS);
		}
	});

	ctx.onInvalidated(() => {
		destroyed = true;
		unsubscribe();
		clearHideTimer();
	});

	return {
		add: store.add,
		update: store.update,
		updatePart: store.updatePart,
		notify: store.notify,
		markStopping: store.markStopping,
		finish: store.finish,
		remove: store.remove,
		highlight: store.highlight,
		setPosition: store.setPosition,
		destroy() {
			destroyed = true;
			unsubscribe();
			clearHideTimer();
			store.destroy();
			if (mounted) {
				mounted = false;
				void ensureUi().then((ui) => ui.remove());
			}
		},
	};
}
