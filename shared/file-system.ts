export type SaveFilePickerOptions = {
	suggestedName?: string;
	startIn?: string;
	types?: {
		description?: string;
		accept: Record<string, string[]>;
	}[];
};

export const MP4_FILE_PICKER_TYPES = [
	{
		description: "MP4 video",
		accept: { "video/mp4": [".mp4"] },
	},
];

export function isFilePickerAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

declare global {
	interface Window {
		showSaveFilePicker?: (
			options?: SaveFilePickerOptions,
		) => Promise<FileSystemFileHandle>;
	}
}
