import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	VideoPickerOverlay,
	type VideoPickerStartResult,
} from "@/entrypoints/content/VideoPickerOverlay";
import { t } from "@/utils/i18n";

function movePointer(): void {
	act(() => {
		window.dispatchEvent(
			new PointerEvent("pointermove", { clientX: 10, clientY: 20 }),
		);
	});
}

function createTrackedVideo(): HTMLVideoElement {
	const video = document.createElement("video");
	document.body.append(video);
	return video;
}

describe("VideoPickerOverlay", () => {
	it("shows instructions while no video is found under the pointer", () => {
		render(<VideoPickerOverlay onClose={vi.fn()} onStart={vi.fn()} />);

		expect(screen.getByText(t("pickerInstructions"))).toBeInTheDocument();
		expect(screen.queryByText(t("videoElementLabel"))).not.toBeInTheDocument();
	});

	it("shows the toolbar alongside the instructions once a video is found under the pointer", () => {
		const video = createTrackedVideo();
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={vi.fn()}
				onStart={vi.fn()}
			/>,
		);

		movePointer();

		expect(screen.getByText(t("videoElementLabel"))).toBeInTheDocument();
		expect(screen.getByText(t("pickerInstructions"))).toBeInTheDocument();
	});

	it("keeps the toolbar once selected even if the pointer moves off every video", () => {
		const video = createTrackedVideo();
		const findVideoAt = vi.fn<() => HTMLVideoElement | null>(() => video);
		render(
			<VideoPickerOverlay
				findVideoAt={findVideoAt}
				onClose={vi.fn()}
				onStart={vi.fn()}
			/>,
		);
		movePointer();

		findVideoAt.mockReturnValue(null);
		movePointer();

		expect(screen.getByText(t("videoElementLabel"))).toBeInTheDocument();
	});

	it("calls onClose when Escape is pressed", () => {
		const onClose = vi.fn();
		render(<VideoPickerOverlay onClose={onClose} onStart={vi.fn()} />);

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }),
			);
		});

		expect(onClose).toHaveBeenCalledOnce();
	});

	it("clears the selection when the tracked video is removed and a scroll event fires", () => {
		const video = createTrackedVideo();
		const onClose = vi.fn();
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={onClose}
				onStart={vi.fn()}
			/>,
		);
		movePointer();
		expect(screen.getByText(t("videoElementLabel"))).toBeInTheDocument();

		video.remove();
		act(() => {
			window.dispatchEvent(new Event("scroll"));
		});

		expect(screen.queryByText(t("videoElementLabel"))).not.toBeInTheDocument();
		expect(screen.getByText(t("pickerInstructions"))).toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("clears the selection when the tracked video is removed without a scroll or resize event", async () => {
		const video = createTrackedVideo();
		const onClose = vi.fn();
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={onClose}
				onStart={vi.fn()}
			/>,
		);
		movePointer();
		expect(screen.getByText(t("videoElementLabel"))).toBeInTheDocument();

		act(() => {
			video.remove();
		});

		await vi.waitFor(() => {
			expect(
				screen.queryByText(t("videoElementLabel")),
			).not.toBeInTheDocument();
		});
		expect(screen.getByText(t("pickerInstructions"))).toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("keeps the selection when the tracked video is re-parented synchronously", async () => {
		const video = createTrackedVideo();
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={vi.fn()}
				onStart={vi.fn()}
			/>,
		);
		movePointer();
		expect(screen.getByText(t("videoElementLabel"))).toBeInTheDocument();

		const container = document.createElement("div");
		document.body.append(container);
		act(() => {
			video.remove();
			container.append(video);
		});

		// Give the MutationObserver callback (a microtask) a chance to run.
		await act(async () => {
			await Promise.resolve();
		});
		expect(screen.getByText(t("videoElementLabel"))).toBeInTheDocument();
	});

	it("disables the start button while onStart is pending and closes on success", async () => {
		const video = createTrackedVideo();
		let resolveStart!: (result: { ok: true }) => void;
		const onStart = vi.fn(
			() =>
				new Promise<{ ok: true }>((resolve) => {
					resolveStart = resolve;
				}),
		);
		const onClose = vi.fn();
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={onClose}
				onStart={onStart}
			/>,
		);
		movePointer();

		const startButton = screen.getByText(t("chooseFolderAndRecord"));
		fireEvent.click(startButton);
		expect(startButton).toBeDisabled();

		resolveStart({ ok: true });
		await vi.waitFor(() => {
			expect(onClose).toHaveBeenCalledOnce();
		});
	});

	it("keeps the picker open when the user cancels the destination picker", async () => {
		const video = createTrackedVideo();
		const onStart = vi.fn(
			async () => ({ ok: false, cancelled: true }) as const,
		);
		const onClose = vi.fn();
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={onClose}
				onStart={onStart}
			/>,
		);
		movePointer();

		fireEvent.click(screen.getByText(t("chooseFolderAndRecord")));

		await vi.waitFor(() => {
			expect(onStart).toHaveBeenCalledOnce();
		});
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByText(t("videoElementLabel"))).toBeInTheDocument();
	});

	it("shows the failure reason when onStart fails", async () => {
		const video = createTrackedVideo();
		const onStart = vi.fn(
			async () => ({ ok: false, reason: "failed" }) as const,
		);
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={vi.fn()}
				onStart={onStart}
			/>,
		);
		movePointer();

		fireEvent.click(screen.getByText(t("chooseFolderAndRecord")));

		expect(await screen.findByText("failed")).toBeInTheDocument();
	});

	it("keeps the failure message mounted when retrying while it is displayed", async () => {
		const video = createTrackedVideo();
		let resolveRetry!: (result: VideoPickerStartResult) => void;
		const onStart = vi
			.fn<() => Promise<VideoPickerStartResult>>()
			.mockResolvedValueOnce({ ok: false, reason: "failed" })
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveRetry = resolve;
					}),
			);
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={vi.fn()}
				onStart={onStart}
			/>,
		);
		movePointer();

		fireEvent.click(screen.getByText(t("chooseFolderAndRecord")));
		const messageElement = await screen.findByText("failed");

		fireEvent.click(screen.getByText(t("chooseFolderAndRecord")));
		expect(screen.getByText("failed")).toBe(messageElement);

		await act(async () => {
			resolveRetry({ ok: false, reason: "failed" });
		});
		expect(screen.getByText("failed")).toBe(messageElement);
	});

	it("clears the failure message when a retry is cancelled", async () => {
		const video = createTrackedVideo();
		const onStart = vi
			.fn<() => Promise<VideoPickerStartResult>>()
			.mockResolvedValueOnce({ ok: false, reason: "failed" })
			.mockResolvedValueOnce({ ok: false, cancelled: true });
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={vi.fn()}
				onStart={onStart}
			/>,
		);
		movePointer();

		fireEvent.click(screen.getByText(t("chooseFolderAndRecord")));
		await screen.findByText("failed");

		fireEvent.click(screen.getByText(t("chooseFolderAndRecord")));
		await vi.waitFor(() => {
			expect(screen.queryByText("failed")).not.toBeInTheDocument();
		});
	});

	it("calls onClose when the cancel button is clicked", () => {
		const video = createTrackedVideo();
		const onClose = vi.fn();
		render(
			<VideoPickerOverlay
				findVideoAt={() => video}
				onClose={onClose}
				onStart={vi.fn()}
			/>,
		);
		movePointer();

		fireEvent.click(screen.getByText(t("cancel")));

		expect(onClose).toHaveBeenCalledOnce();
	});

	it("stops reacting to pointer movement after unmount", () => {
		const video = createTrackedVideo();
		const findVideoAt = vi.fn(() => video);
		const { unmount } = render(
			<VideoPickerOverlay
				findVideoAt={findVideoAt}
				onClose={vi.fn()}
				onStart={vi.fn()}
			/>,
		);
		unmount();
		findVideoAt.mockClear();

		movePointer();

		expect(findVideoAt).not.toHaveBeenCalled();
	});
});
