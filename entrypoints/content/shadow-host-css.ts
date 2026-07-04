/**
 * WXT's :host{all:initial !important} reset cancels out the z-index and other
 * properties WXT itself sets via inline style. The css option is concatenated
 * after the reset, so we restore the same values as applyPosition using
 * !important, which wins by taking precedence last.
 */
export const SHADOW_HOST_CSS = `
:host {
	display: block !important;
	position: relative !important;
	width: 0 !important;
	height: 0 !important;
	overflow: visible !important;
	z-index: 2147483647 !important;
}
`;
