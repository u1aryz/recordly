import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
	createShadowRootUi,
	type ShadowRootContentScriptUi,
} from "wxt/utils/content-script-ui/shadow-root";
import { createShadowHostCss, PICKER_Z_INDEX } from "./shadow-host-css";
import {
	VideoPickerOverlay,
	type VideoPickerStartResult,
} from "./VideoPickerOverlay";

export type { VideoPickerStartResult };

export type VideoPickerUiOptions = {
	onStart: (video: HTMLVideoElement) => Promise<VideoPickerStartResult>;
};

export type VideoPickerUi = {
	start: () => void;
	destroy: () => void;
};

export function createVideoPickerUi(
	ctx: ContentScriptContext,
	options: VideoPickerUiOptions,
): VideoPickerUi {
	let active = false;
	let uiPromise: Promise<ShadowRootContentScriptUi<Root>> | undefined;

	function ensureUi(): Promise<ShadowRootContentScriptUi<Root>> {
		uiPromise ??= createShadowRootUi(ctx, {
			name: "recordly-video-picker",
			position: "overlay",
			zIndex: PICKER_Z_INDEX,
			css: createShadowHostCss(PICKER_Z_INDEX),
			onMount(container) {
				const appRoot = document.createElement("div");
				container.append(appRoot);
				const root = createRoot(appRoot);
				root.render(
					<StrictMode>
						<VideoPickerOverlay onClose={close} onStart={options.onStart} />
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

	function close(): void {
		if (!active) {
			return;
		}
		active = false;
		// onClose is called from an event inside the React tree, so we avoid a synchronous
		// unmount and defer it to the next macrotask.
		void uiPromise?.then((ui) => {
			setTimeout(() => {
				if (!active) {
					ui.remove();
				}
			}, 0);
		});
	}

	return {
		start() {
			if (active) {
				return;
			}
			active = true;
			void ensureUi().then((ui) => {
				if (active) {
					ui.mount();
				}
			});
		},
		destroy() {
			active = false;
			void uiPromise?.then((ui) => ui.remove());
		},
	};
}
