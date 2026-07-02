import { describe, expect, it } from "vitest";
import {
	createMonitorState,
	evaluateMonitorTick,
	evaluateRecordingTick,
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

describe("evaluateRecordingTick", () => {
	function baseInput(
		overrides: Partial<Parameters<typeof evaluateRecordingTick>[1]> = {},
	) {
		return {
			connected: true,
			current: RECORDED,
			recorded: RECORDED,
			continueOnResolutionChange: true,
			recorderRecording: true,
			paused: false,
			seeking: false,
			nowMs: 0,
			lastDataAtMs: 0,
			...overrides,
		};
	}

	function settleResolutionChange(
		state: ReturnType<typeof createMonitorState>,
		changed: { width: number; height: number },
		overrides: Partial<Parameters<typeof evaluateRecordingTick>[1]> = {},
	) {
		for (let tick = 1; tick < RESOLUTION_STABLE_TICKS; tick += 1) {
			evaluateRecordingTick(
				state,
				baseInput({ current: changed, ...overrides }),
			);
		}
		return evaluateRecordingTick(
			state,
			baseInput({ current: changed, ...overrides }),
		);
	}

	it("rolls over when the resolution changes and continueOnResolutionChange is enabled", () => {
		const state = createMonitorState();
		const changed = { width: 1280, height: 720 };
		const commands = settleResolutionChange(state, changed, {
			continueOnResolutionChange: true,
		});
		expect(commands).toEqual([
			{ type: "rollover", change: { from: RECORDED, to: changed } },
		]);
	});

	it("stops with the change details when continueOnResolutionChange is disabled", () => {
		const state = createMonitorState();
		const changed = { width: 1280, height: 720 };
		const commands = settleResolutionChange(state, changed, {
			continueOnResolutionChange: false,
		});
		expect(commands).toEqual([
			{
				type: "stop",
				reason: "resolution_changed",
				change: { from: RECORDED, to: changed },
			},
		]);
	});

	it("stops once the video has been disconnected past the grace period", () => {
		const state = createMonitorState();
		for (let tick = 1; tick < VIDEO_REMOVED_GRACE_TICKS; tick += 1) {
			expect(
				evaluateRecordingTick(state, baseInput({ connected: false })),
			).toEqual([]);
		}
		expect(
			evaluateRecordingTick(state, baseInput({ connected: false })),
		).toEqual([{ type: "stop", reason: "video_removed" }]);
	});

	it("stops after the no-data timeout while recording", () => {
		const state = createMonitorState();
		const commands = evaluateRecordingTick(
			state,
			baseInput({ nowMs: NO_DATA_TIMEOUT_MS, lastDataAtMs: 0 }),
		);
		expect(commands).toEqual([{ type: "stop", reason: "no_data_timeout" }]);
	});

	it("suppresses the no-data timeout while the video is paused", () => {
		const state = createMonitorState();
		const commands = evaluateRecordingTick(
			state,
			baseInput({ nowMs: NO_DATA_TIMEOUT_MS, lastDataAtMs: 0, paused: true }),
		);
		expect(commands).toEqual([]);
	});

	it("suppresses the no-data timeout while the video is seeking", () => {
		const state = createMonitorState();
		const commands = evaluateRecordingTick(
			state,
			baseInput({ nowMs: NO_DATA_TIMEOUT_MS, lastDataAtMs: 0, seeking: true }),
		);
		expect(commands).toEqual([]);
	});

	it("suppresses the no-data timeout once the recorder is no longer recording", () => {
		const state = createMonitorState();
		const commands = evaluateRecordingTick(
			state,
			baseInput({
				nowMs: NO_DATA_TIMEOUT_MS,
				lastDataAtMs: 0,
				recorderRecording: false,
			}),
		);
		expect(commands).toEqual([]);
	});

	it("emits both a rollover and a stop command on the same tick, in that order", () => {
		const state = createMonitorState();
		const changed = { width: 1280, height: 720 };
		for (let tick = 1; tick < RESOLUTION_STABLE_TICKS; tick += 1) {
			evaluateRecordingTick(state, baseInput({ current: changed }));
		}
		const commands = evaluateRecordingTick(
			state,
			baseInput({
				current: changed,
				nowMs: NO_DATA_TIMEOUT_MS,
				lastDataAtMs: 0,
			}),
		);
		expect(commands).toEqual([
			{ type: "rollover", change: { from: RECORDED, to: changed } },
			{ type: "stop", reason: "no_data_timeout" },
		]);
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
