# Recordly

## 概要

Recordly は Web ページ上の動画を選択し、キャプチャして保存するためのブラウザ拡張です。

動画の選択、キャプチャの開始、進捗確認、停止後のダウンロードまでを拡張機能内で行えます。

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

起動後、ブラウザに拡張を読み込みます。動画があるページで拡張アイコンを押し、popup の「ページ上で動画を選択」から録画したい動画を選択してください。表示されたメニューの「キャプチャ開始」から録画を開始し、captures ページで停止後にダウンロードします。
