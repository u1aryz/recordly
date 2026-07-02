import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoPicker, type VideoPicker } from "@/shared/video-picker";

const createdPickers: VideoPicker[] = [];

function setUpPicker(
	...args: Parameters<typeof createVideoPicker>
): VideoPicker {
	const picker = createVideoPicker(...args);
	createdPickers.push(picker);
	return picker;
}

function getHost(): HTMLElement | null {
	return document.querySelector("[data-recordly-video-picker]");
}

function movePointer(): void {
	window.dispatchEvent(
		new PointerEvent("pointermove", { clientX: 10, clientY: 20 }),
	);
}

afterEach(() => {
	// pointermove などの window リスナーが次のテストへ漏れないよう、必ず破棄する。
	for (const picker of createdPickers.splice(0)) {
		picker.destroy();
	}
	getHost()?.remove();
});

describe("createVideoPicker", () => {
	it("mounts the host and shows instructions once started", () => {
		const picker = setUpPicker({ onStart: vi.fn() });
		picker.start();

		const host = getHost();
		expect(host).not.toBeNull();
		expect(
			host?.shadowRoot?.querySelector(".instructions"),
		).not.toHaveAttribute("hidden");
	});

	it("shows the frame and toolbar once a video is found under the pointer", () => {
		const video = document.createElement("video");
		document.body.append(video);
		const picker = setUpPicker({
			onStart: vi.fn(),
			findVideoAt: () => video,
		});
		picker.start();
		movePointer();

		const shadow = getHost()?.shadowRoot;
		expect(shadow?.querySelector(".frame")).not.toHaveAttribute("hidden");
		expect(shadow?.querySelector(".toolbar")).not.toHaveAttribute("hidden");
		expect(shadow?.querySelector(".instructions")).toHaveAttribute("hidden");
	});

	it("stops and removes the host when Escape is pressed", () => {
		const picker = setUpPicker({ onStart: vi.fn() });
		picker.start();
		expect(getHost()).not.toBeNull();

		window.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
		);

		expect(getHost()).toBeNull();
	});

	it("stops tracking the video once it is removed from the document", () => {
		const video = document.createElement("video");
		document.body.append(video);
		const picker = setUpPicker({
			onStart: vi.fn(),
			findVideoAt: () => video,
		});
		picker.start();
		movePointer();
		expect(getHost()).not.toBeNull();

		video.remove();
		window.dispatchEvent(new Event("scroll"));

		expect(getHost()).toBeNull();
	});

	it("disables the start button while onStart is pending and closes on success", async () => {
		const video = document.createElement("video");
		document.body.append(video);
		let resolveStart!: (result: { ok: true }) => void;
		const onStart = vi.fn(
			() =>
				new Promise<{ ok: true }>((resolve) => {
					resolveStart = resolve;
				}),
		);
		const picker = setUpPicker({ onStart, findVideoAt: () => video });
		picker.start();
		movePointer();

		const shadow = getHost()?.shadowRoot;
		const startButton = shadow?.querySelector<HTMLButtonElement>(".start");
		startButton?.click();
		expect(startButton).toBeDisabled();

		resolveStart({ ok: true });
		await Promise.resolve();
		await Promise.resolve();

		expect(getHost()).toBeNull();
	});

	it("keeps the picker open when the user cancels the destination picker", async () => {
		const video = document.createElement("video");
		document.body.append(video);
		const onStart = vi.fn(
			async () => ({ ok: false, cancelled: true }) as const,
		);
		const picker = setUpPicker({ onStart, findVideoAt: () => video });
		picker.start();
		movePointer();

		const shadow = getHost()?.shadowRoot;
		shadow?.querySelector<HTMLButtonElement>(".start")?.click();
		await Promise.resolve();
		await Promise.resolve();

		expect(getHost()).not.toBeNull();
		expect(shadow?.querySelector(".message")).toHaveAttribute("hidden");
	});

	it("shows the failure reason when onStart fails", async () => {
		const video = document.createElement("video");
		document.body.append(video);
		const onStart = vi.fn(
			async () => ({ ok: false, reason: "failed" }) as const,
		);
		const picker = setUpPicker({ onStart, findVideoAt: () => video });
		picker.start();
		movePointer();

		const shadow = getHost()?.shadowRoot;
		shadow?.querySelector<HTMLButtonElement>(".start")?.click();
		await Promise.resolve();
		await Promise.resolve();

		expect(shadow?.querySelector(".message")).not.toHaveAttribute("hidden");
		expect(shadow?.querySelector(".message")).toHaveTextContent("failed");
	});

	it("stops when the cancel button is clicked", () => {
		const picker = setUpPicker({ onStart: vi.fn() });
		picker.start();
		const shadow = getHost()?.shadowRoot;
		shadow?.querySelector<HTMLButtonElement>(".cancel")?.click();
		expect(getHost()).toBeNull();
	});

	it("stops reacting to pointer movement after destroy", () => {
		const video = document.createElement("video");
		document.body.append(video);
		const findVideoAt = vi.fn(() => video);
		const picker = setUpPicker({ onStart: vi.fn(), findVideoAt });
		picker.start();
		picker.destroy();
		findVideoAt.mockClear();

		movePointer();

		expect(findVideoAt).not.toHaveBeenCalled();
	});
});
