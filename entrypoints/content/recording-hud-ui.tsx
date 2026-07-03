import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
	createShadowRootUi,
	type ShadowRootContentScriptUi,
} from "wxt/utils/content-script-ui/shadow-root";
import type { HudPosition } from "@/shared/settings";
import type { CaptureMetadata } from "@/shared/types";
import { createHudStore, type HudTone } from "./hud-store";
import { RecordingHud } from "./RecordingHud";
import { SHADOW_HOST_CSS } from "./shadow-host-css";

export type RecordingHudManager = {
	add: (metadata: CaptureMetadata) => void;
	update: (captureId: string, elapsedMs: number) => void;
	updatePart: (captureId: string, partCount: number) => void;
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
			zIndex: 2147483647,
			css: SHADOW_HOST_CSS,
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

	const unsubscribe = store.subscribe(() => {
		const hasRows = store.getSnapshot().rows.length > 0;
		if (hasRows && !mounted) {
			mounted = true;
			void ensureUi().then((ui) => {
				if (store.getSnapshot().rows.length > 0) {
					ui.mount();
				} else {
					mounted = false;
				}
			});
			return;
		}
		if (!hasRows && mounted) {
			mounted = false;
			void ensureUi().then((ui) => ui.remove());
		}
	});

	ctx.onInvalidated(() => {
		destroyed = true;
		unsubscribe();
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
			store.destroy();
			if (mounted) {
				mounted = false;
				void ensureUi().then((ui) => ui.remove());
			}
		},
	};
}
