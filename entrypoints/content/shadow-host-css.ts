/**
 * WXT の :host{all:initial !important} リセットは、WXT 自身が inline style で
 * 設定する z-index などを打ち消してしまう。css オプションはリセットの後に
 * 連結されるため、後勝ちの !important で applyPosition と同じ値を復元する。
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
