import type { ResolutionChange, VideoResolution } from "./types";

export const VIDEO_REMOVED_GRACE_TICKS = 4;
export const RESOLUTION_STABLE_TICKS = 2;
export const NO_DATA_TIMEOUT_MS = 12_000;
export const FORCE_FINALIZE_TIMEOUT_MS = 8_000;

export type MonitorState = {
	disconnectedTicks: number;
	candidate: VideoResolution | null;
	candidateTicks: number;
};

export function createMonitorState(): MonitorState {
	return {
		disconnectedTicks: 0,
		candidate: null,
		candidateTicks: 0,
	};
}

export type MonitorAction =
	| { type: "none" }
	| { type: "video_removed" }
	| { type: "resolution_changed"; change: ResolutionChange };

export function evaluateMonitorTick(
	state: MonitorState,
	input: {
		connected: boolean;
		current: VideoResolution;
		recorded: VideoResolution;
	},
): MonitorAction {
	if (!input.connected) {
		state.disconnectedTicks += 1;
		if (state.disconnectedTicks < VIDEO_REMOVED_GRACE_TICKS) {
			return { type: "none" };
		}
		return { type: "video_removed" };
	}
	state.disconnectedTicks = 0;

	if (!isValidResolution(input.current)) {
		state.candidate = null;
		state.candidateTicks = 0;
		return { type: "none" };
	}

	if (isSameResolution(input.current, input.recorded)) {
		state.candidate = null;
		state.candidateTicks = 0;
		return { type: "none" };
	}

	if (state.candidate && isSameResolution(input.current, state.candidate)) {
		state.candidateTicks += 1;
	} else {
		state.candidate = input.current;
		state.candidateTicks = 1;
	}

	if (state.candidateTicks < RESOLUTION_STABLE_TICKS) {
		return { type: "none" };
	}

	const change: ResolutionChange = { from: input.recorded, to: input.current };
	state.candidate = null;
	state.candidateTicks = 0;
	return { type: "resolution_changed", change };
}

export function hasDataTimedOut(
	nowMs: number,
	lastDataAtMs: number,
	timeoutMs: number = NO_DATA_TIMEOUT_MS,
): boolean {
	return nowMs - lastDataAtMs >= timeoutMs;
}

function isValidResolution(resolution: VideoResolution): boolean {
	return resolution.width > 0 && resolution.height > 0;
}

function isSameResolution(a: VideoResolution, b: VideoResolution): boolean {
	return a.width === b.width && a.height === b.height;
}
