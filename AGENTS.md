このファイルはコードエージェントがこのプロジェクトを理解するためのガイドです。

## プロジェクト概要

Recordly は、Web ページ上の動画を選択し、キャプチャして MP4 として保存する WXT ベースのブラウザ拡張です。React で popup と captures 画面を構成し、拡張機能の background/content script と共有ロジックで録画状態や動画情報を扱います。

対応対象は Chromium/Chrome です。Firefox は、直接ファイル保存に使う File System Access API（`showSaveFilePicker`）と `MediaRecorder` の MP4 出力を必要な構成で利用できないため、非対応です。

主な構成は次のとおりです。

- `entrypoints/background.ts`: 拡張機能の background 処理。
- `entrypoints/content.ts`: Web ページに注入される content script。
- `entrypoints/popup/`: 拡張アイコンから開く popup UI。
- `entrypoints/captures/`: キャプチャ進捗や停止後のダウンロードを扱う UI。
- `shared/`: message、storage、capture state、video、binary などの共有ロジック。
- `utils/`: i18n などの補助処理。
- `tests/`: Vitest による共有ロジックのテスト。
- `e2e/`: Playwright による E2E テスト(拡張機能を実ブラウザにロードしてピッカー操作〜録画保存まで検証)。

## 開発コマンド

コードエージェントは pnpm ベースで作業します。通常の実装・検証で使うコマンドだけをここに記載します。

- `pnpm install`: 依存関係をインストールします。
- `pnpm dev`: Chromium/Chrome 向けに WXT 開発サーバーを起動します。
- `pnpm build`: Chromium/Chrome 向けに拡張機能をビルドします。
- `pnpm typecheck`: TypeScript の型チェックを実行します。
- `pnpm test`: Vitest のユニットテストを実行します(`tests/` のみ。E2E は含まれません)。
- `pnpm test:e2e`: Playwright の E2E テストを実行します(ビルドを含みます)。初回のみ `pnpm exec playwright install chromium` が必要です。
- `pnpm format`: Biome による check と自動修正を実行します。

## コードスタイル

- フォーマットと lint は `biome.json` に従います。
- インデントはタブ、文字列はダブルクォートを使います。
- Biome の recommended rule、未使用 import 禁止、ブロック文必須、Tailwind class sort を前提にします。
- 非同期処理は `async/await` を優先します。
- `try` ブロック内で意図的にエラーをスローしないでください。例外を制御フローとして使わず、条件分岐や戻り値で表現できる設計を優先します。
- ユーザー向けに表示する文言はコードへ直接記述せず、`public/_locales/` に日英のメッセージを追加し、`utils/i18n.ts` の `t()` を介して取得してください。
- WXT ブラウザ拡張、React/UI、daisyUI/Tailwind、Playwright などに関わる作業では、利用可能な各種スキルを参照してから実装・検証します。
- 既存の型、共有関数、ディレクトリ構成を優先し、不要な抽象化や大きな移動は避けます。

## 開発フロー

- 変更前に関連ファイル、既存テスト、設定ファイルを確認します。
- 実装は既存構成に合わせます。共有ロジックは `shared/`、UI は該当する `entrypoints/` 配下に置きます。
- 変更後は `pnpm typecheck` と `pnpm test` を実行します。
- ビルドや manifest、entrypoint、権限に関わる変更では、必要に応じて `pnpm build` も実行します。
- content script の UI(動画ピッカー、録画 HUD)や録画フローの挙動変更では、`pnpm test:e2e` も実行します。
- UI や拡張機能の挙動変更では、`pnpm dev` で手動確認できる状態にします。
- 既存の未コミット変更がある場合は、ユーザーの作業として扱い、勝手に戻したり上書きしたりしません。

## 注意事項

- コミットは Conventional Commits に従い、説明部分は日本語で書きます。
- 英語で考えて、日本語でやり取りします。
- linter エラーはリファクタリングで解決することを優先します。Biome 設定を見直す必要がある場合は、先にユーザーへ確認します。
- ブラウザ拡張では、権限追加、manifest 変更、storage schema 変更の影響範囲を慎重に確認します。
- `zip` 系コマンドや mise 系コマンドは、通常のコードエージェント作業では使わない前提です。
