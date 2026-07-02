import { describe, expect, it } from "vitest";
import {
	createMonitorState,
	evaluateMonitorTick,
	hasDataTimedOut,
	NO_DATA_TIMEOUT_MS,
	RESOLUTION_STABLE_TICKS,
	VIDEO_REMOVED_GRACE_TICKS,
} from "@/shared/recording-monitor";

const RECORDED = { width: 1920, height: 1080 };

describe("evaluateMonitorTick", () => {
	it("does nothing while the resolution matches the recorded one", () => {
		const state = createMonitorState();
		const action = evaluateMonitorTick(state, {
			connected: true,
			current: RECORDED,
			recorded: RECORDED,
		});
		expect(action).toEqual({ type: "none" });
	});

	it("does not fire on the first tick a new resolution is observed", () => {
		const state = createMonitorState();
		const action = evaluateMonitorTick(state, {
			connected: true,
			current: { width: 1280, height: 720 },
			recorded: RECORDED,
		});
		expect(action).toEqual({ type: "none" });
	});

	it("fires resolution_changed once the new resolution is stable", () => {
		const state = createMonitorState();
		const changed = { width: 1280, height: 720 };
		for (let tick = 1; tick < RESOLUTION_STABLE_TICKS; tick += 1) {
			expect(
				evaluateMonitorTick(state, {
					connected: true,
					current: changed,
					recorded: RECORDED,
				}),
			).toEqual({ type: "none" });
		}
		const action = evaluateMonitorTick(state, {
			connected: true,
			current: changed,
			recorded: RECORDED,
		});
		expect(action).toEqual({
			type: "resolution_changed",
			change: { from: RECORDED, to: changed },
		});
	});

	it("resets the candidate when the resolution flaps back and forth", () => {
		const state = createMonitorState();
		evaluateMonitorTick(state, {
			connected: true,
			current: { width: 1280, height: 720 },
			recorded: RECORDED,
		});
		const backToRecorded = evaluateMonitorTick(state, {
			connected: true,
			current: RECORDED,
			recorded: RECORDED,
		});
		expect(backToRecorded).toEqual({ type: "none" });

		evaluateMonitorTick(state, {
			connected: true,
			current: { width: 1280, height: 720 },
			recorded: RECORDED,
		});
		const settled = evaluateMonitorTick(state, {
			connected: true,
			current: { width: 1280, height: 720 },
			recorded: RECORDED,
		});
		expect(settled).toEqual({
			type: "resolution_changed",
			change: { from: RECORDED, to: { width: 1280, height: 720 } },
		});
	});

	it("restarts the candidate counter when the resolution changes again mid-flight", () => {
		const state = createMonitorState();
		evaluateMonitorTick(state, {
			connected: true,
			current: { width: 1280, height: 720 },
			recorded: RECORDED,
		});
		const switchedAgain = evaluateMonitorTick(state, {
			connected: true,
			current: { width: 640, height: 360 },
			recorded: RECORDED,
		});
		expect(switchedAgain).toEqual({ type: "none" });
		const settled = evaluateMonitorTick(state, {
			connected: true,
			current: { width: 640, height: 360 },
			recorded: RECORDED,
		});
		expect(settled).toEqual({
			type: "resolution_changed",
			change: { from: RECORDED, to: { width: 640, height: 360 } },
		});
	});

	it("ignores non-positive resolutions", () => {
		const state = createMonitorState();
		const action = evaluateMonitorTick(state, {
			connected: true,
			current: { width: 0, height: 0 },
			recorded: RECORDED,
		});
		expect(action).toEqual({ type: "none" });
	});

	it("reports video_removed only after the grace period elapses", () => {
		const state = createMonitorState();
		for (let tick = 1; tick < VIDEO_REMOVED_GRACE_TICKS; tick += 1) {
			expect(
				evaluateMonitorTick(state, {
					connected: false,
					current: RECORDED,
					recorded: RECORDED,
				}),
			).toEqual({ type: "none" });
		}
		expect(
			evaluateMonitorTick(state, {
				connected: false,
				current: RECORDED,
				recorded: RECORDED,
			}),
		).toEqual({ type: "video_removed" });
	});

	it("resets the disconnect counter once the video reconnects", () => {
		const state = createMonitorState();
		evaluateMonitorTick(state, {
			connected: false,
			current: RECORDED,
			recorded: RECORDED,
		});
		evaluateMonitorTick(state, {
			connected: true,
			current: RECORDED,
			recorded: RECORDED,
		});
		for (let tick = 1; tick < VIDEO_REMOVED_GRACE_TICKS; tick += 1) {
			expect(
				evaluateMonitorTick(state, {
					connected: false,
					current: RECORDED,
					recorded: RECORDED,
				}),
			).toEqual({ type: "none" });
		}
	});
});

describe("hasDataTimedOut", () => {
	it("is false just under the timeout", () => {
		expect(hasDataTimedOut(NO_DATA_TIMEOUT_MS - 1, 0)).toBe(false);
	});

	it("is true exactly at the timeout", () => {
		expect(hasDataTimedOut(NO_DATA_TIMEOUT_MS, 0)).toBe(true);
	});

	it("is true past the timeout", () => {
		expect(hasDataTimedOut(NO_DATA_TIMEOUT_MS + 1, 0)).toBe(true);
	});

	it("accepts a custom timeout", () => {
		expect(hasDataTimedOut(5000, 0, 5000)).toBe(true);
		expect(hasDataTimedOut(4999, 0, 5000)).toBe(false);
	});
});
