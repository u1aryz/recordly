/**
 * The recording HUD must always stack above the video picker overlay: it shows
 * live recording status, hosts the stop button, and is highlighted while the
 * picker is open, so it must never be covered by the picker's panels.
 */
export const HUD_Z_INDEX = 2147483647;
export const PICKER_Z_INDEX = HUD_Z_INDEX - 1;

/**
 * WXT's :host{all:initial !important} reset cancels out the z-index and other
 * properties WXT itself sets via inline style. The css option is concatenated
 * after the reset, so we restore the same values as applyPosition using
 * !important, which wins by taking precedence last.
 */
export function createShadowHostCss(zIndex: number): string {
	return `
:host {
	display: block !important;
	position: relative !important;
	width: 0 !important;
	height: 0 !important;
	overflow: visible !important;
	z-index: ${zIndex} !important;
}
`;
}
