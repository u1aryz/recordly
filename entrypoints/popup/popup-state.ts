import { listCaptures } from "@/shared/storage";
import type { CaptureMetadata, VideoDescriptor } from "@/shared/types";
import { t } from "@/utils/i18n";

export type PopupState = {
	loading: boolean;
	error?: string;
	videos: VideoDescriptor[];
	recordingCount: number;
};

export async function getActiveTabId(): Promise<number> {
	const [tab] = await browser.tabs.query({
		active: true,
		currentWindow: true,
	});
	if (tab?.id == null) {
		throw new Error(t("activeTabUnavailable"));
	}
	return tab.id;
}

export function countRecordingCaptures(captures: CaptureMetadata[]): number {
	return captures.filter((capture) => capture.status === "recording").length;
}

export async function loadPopupState(): Promise<PopupState> {
	const tabId = await getActiveTabId();
	const response = await browser.tabs.sendMessage(tabId, {
		type: "LIST_VIDEOS",
	});
	const captures = await listCaptures();
	return {
		loading: false,
		videos: response?.videos ?? [],
		recordingCount: countRecordingCaptures(captures),
	};
}
