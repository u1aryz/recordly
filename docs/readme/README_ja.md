# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/u1aryz/recordly)](https://github.com/u1aryz/recordly/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Web ページ上の動画を選んで録画し、MP4 としてそのままディスクに保存 — 画面共有ダイアログも、書き出しの再エンコードも不要です。

[English](../../README.md) | 日本語 | [Español](README_es.md) | [한국어](README_ko.md) | [简体中文](README_zh-CN.md)

![デモ](../assets/demo.gif)

## 特長

- **クリックで動画を選択** — タブや画面の共有ではなく、ページ上の録画したい `<video>` 要素そのものを選べます。
- **MP4 をディスクへ直接保存** — File System Access API により録画データを選択した保存先へ直接書き込むため、停止時の書き出しや再エンコードがありません。
- **長時間録画に対応** — 録画データはおおよそ 2GB ごとに分割して保存されるため、長時間のセッションでも安心です。
- **録画 HUD と進捗ページ** — 録画中はページ上の HUD で、進捗やダウンロードは captures ページで確認できます。
- **5言語対応** — English、日本語、Español、한국어、简体中文。

## インストール

Recordly はまだ Chrome Web Store では公開されていません。リリースからインストールしてください。

1. [最新リリース](https://github.com/u1aryz/recordly/releases/latest)から `recordly-x.x.x-chrome.zip` をダウンロードして展開します。
2. `chrome://extensions` を開き、右上の**デベロッパーモード**を有効にします。
3. **パッケージ化されていない拡張機能を読み込む**をクリックし、展開したフォルダを選択します。

### 対応ブラウザ

Recordly は Chromium/Chrome 向けです。Firefox には対応していません。録画したデータを保存先へ直接書き込む File System Access API(`showSaveFilePicker`)と、`MediaRecorder` による MP4 出力を前提としており、Firefox ではこれらの必要な機能を同じ構成で利用できないためです。

## 使い方

1. 動画があるページで拡張アイコンを押し、popup の「**ページ上で録画する動画を選ぶ**」を選択します。
2. 録画したい動画をクリックし、表示されたメニューの「**保存フォルダを選択して録画開始**」から保存先を指定して録画を開始します。
3. 録画中は captures ページで進捗を確認できます。停止すると、指定した保存先への MP4 の保存が完了します。

## 開発

前提条件: Node.js >= 22 と pnpm。代わりに [mise](https://mise.jdx.dev/) を使う場合は、`mise install` でツールチェーンを導入できます。

```bash
pnpm install
pnpm dev        # Chromium/Chrome 向けの WXT 開発サーバーを起動
pnpm build      # 拡張機能をビルド
```

### テスト

共有ロジックのユニットテスト(Vitest)を実行します。

```bash
pnpm test
```

E2E テスト(Playwright)は、ビルドした拡張機能を実ブラウザにロードし、動画の選択から録画開始・MP4 の保存までを検証します。

```bash
pnpm test:e2e
```

E2E テストの初回実行前に、Playwright のブラウザをインストールしてください。

```bash
pnpm exec playwright install chromium
```

## コントリビューション

[Contributing Guide](../CONTRIBUTING.md)(英語)を参照してください。本プロジェクトは[行動規範](../../CODE_OF_CONDUCT.md)に従います。脆弱性の報告は[セキュリティポリシー](../../SECURITY.md)を参照してください。

## ライセンス

[MIT](../../LICENSE)
