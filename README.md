# Recordly

## 概要

Recordly は Web ページ上の動画を選択し、キャプチャして保存するためのブラウザ拡張です。

動画の選択、保存先の指定、キャプチャの開始、進捗確認、停止時の MP4 保存までを拡張機能内で行えます。

録画データは、おおよそ 2GB ごとに分割して保存されます。

## 対応ブラウザ

Recordly は Chromium/Chrome 向けです。Firefox には対応していません。

録画したデータを保存先へ直接書き込む File System Access API（`showSaveFilePicker`）と、`MediaRecorder` による MP4 出力を前提としており、Firefox ではこれらの必要な機能を同じ構成で利用できないためです。

## 前提条件

- mise

## セットアップ

```bash
mise install
```

## 使い方

開発サーバーを起動します。

```bash
mise run dev
```

ビルドする場合は次のコマンドを使います。

```bash
mise run build
```

起動後、ブラウザに拡張を読み込みます。動画があるページで拡張アイコンを押し、popup の「ページ上で動画を選択」から録画したい動画を選択してください。表示されたメニューの「保存先を選択して録画開始」から保存先を指定して録画を開始します。録画中は captures ページで進捗を確認でき、停止すると指定した保存先への MP4 の保存が完了します。

## テスト

共有ロジックのユニットテスト（Vitest）を実行します。

```bash
mise run test
```

E2E テスト（Playwright）は、ビルドした拡張機能を実ブラウザにロードし、動画の選択から録画開始・MP4 の保存までを検証します。

```bash
mise run test:e2e
```

E2E テストの初回実行前に、Playwright のブラウザをインストールしてください。

```bash
pnpm exec playwright install chromium
```
