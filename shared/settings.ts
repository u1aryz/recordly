import { storage } from "wxt/utils/storage";

export type HudPosition = {
	left: number;
	top: number;
};

export const recordingHudPosition = storage.defineItem<HudPosition | null>(
	"local:recordingHudPosition",
	{
		fallback: null,
	},
);

export const continueOnResolutionChange = storage.defineItem<boolean>(
	"local:continueOnResolutionChange",
	{
		fallback: true,
	},
);
