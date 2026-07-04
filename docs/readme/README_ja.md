# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

[English](../../README.md) | 日本語 | [Español](README_es.md) | [한국어](README_ko.md) | [简体中文](README_zh-CN.md)

## 概要

Recordly は Web ページ上の動画を選択し、キャプチャして保存するためのブラウザ拡張です。

動画の選択、保存先の指定、キャプチャの開始、進捗確認、停止時の MP4 保存までを拡張機能内で行えます。

録画データは、おおよそ 2GB ごとに分割して保存されます。

![デモ](../assets/demo.gif)

## 対応ブラウザ

Recordly は Chromium/Chrome 向けです。Firefox には対応していません。

録画したデータを保存先へ直接書き込む File System Access API(`showSaveFilePicker`)と、`MediaRecorder` による MP4 出力を前提としており、Firefox ではこれらの必要な機能を同じ構成で利用できないためです。

## 前提条件

- Node.js >= 22
- pnpm

代わりに [mise](https://mise.jdx.dev/) を使う場合は、`mise install` でツールチェーンを導入できます。

## セットアップ

```bash
pnpm install
```

## 使い方

開発サーバーを起動します。

```bash
pnpm dev
```

ビルドする場合は次のコマンドを使います。

```bash
pnpm build
```

起動後、ブラウザに拡張を読み込みます。動画があるページで拡張アイコンを押し、popup の「ページ上で録画する動画を選ぶ」から録画したい動画を選択してください。表示されたメニューの「保存フォルダを選択して録画開始」から保存先を指定して録画を開始します。録画中は captures ページで進捗を確認でき、停止すると指定した保存先への MP4 の保存が完了します。

## テスト

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

[Contributing Guide](../CONTRIBUTING.md)(英語)を参照してください。

## ライセンス

[MIT](../../LICENSE)
