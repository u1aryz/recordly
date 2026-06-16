# Video Capture Picker

ページ上の `video` タグを DevTools の element picker のように選択し、キャプチャして保存するブラウザ拡張です。

## できること

- popup から「ページ上で動画を選択」を開始
- カーソルが `video` に乗ったら、枠線と小さなメニューを表示
- メニューの「キャプチャ開始」から captures ページを開いて録画開始
- captures ページで経過時間、ファイルサイズ、チャンク数、サムネイルを表示
- 録画中は停止、停止後はダウンロード
- 完了済みキャプチャは IndexedDB に残り、captures ページを閉じても再ダウンロード可能

## 重要な制限

- v1 は通常ページ上の `video` タグが対象です。iframe 内 video は保証対象外です。
- DRM/EME など保護された動画、録画が禁止されている動画はキャプチャできない場合があります。
- サムネイルは `canvas.drawImage(video)` を使うため、動画によってはブラウザの制約で生成できないことがあります。
- MP4 録画はブラウザが `MediaRecorder` の MP4 mime type に対応している場合に動作します。非対応ブラウザでは明確なエラーにします。
- Mediabunny は依存に入れていますが、現時点の実装は安定した v1 として MediaRecorder MP4 経路を使っています。WebCodecs + Mediabunny muxing は次の改善ポイントです。
- Firefox は best-effort 対応です。Chrome 系ブラウザを primary target として確認してください。

## 開発

```bash
pnpm install
pnpm dev
```

Firefox で確認する場合:

```bash
pnpm dev:firefox
```

型チェックとテスト:

```bash
pnpm typecheck
pnpm test
```

ビルド:

```bash
pnpm build
pnpm build:firefox
```

## 使い方

1. 開発サーバーを起動し、ブラウザに拡張を読み込みます。
2. 動画があるページで拡張アイコンを押します。
3. popup の「ページ上で動画を選択」を押します。
4. 録画したい動画にカーソルを乗せます。
5. 表示されたメニューから「キャプチャ開始」を押します。
6. captures ページで進捗を確認し、停止後にダウンロードします。

## 実装メモ

- WXT + React + Tailwind CSS + daisyUI で構成しています。
- extension API は `webextension-polyfill` の `browser.*` に統一しています。
- popup、content script、captures page、background を entrypoint として分離しています。
- 大容量データは `chrome.storage` / `browser.storage` ではなく IndexedDB にチャンク保存します。
- 長時間更新のため、captures page は `runtime.connect` の Port で background から進捗を受け取ります。
