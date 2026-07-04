# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

[English](../../README.md) | [日本語](README_ja.md) | [Español](README_es.md) | 한국어 | [简体中文](README_zh-CN.md)

## 개요

Recordly는 웹 페이지의 동영상을 선택해 캡처하고 저장하는 브라우저 확장 프로그램입니다.

동영상 선택, 저장 위치 지정, 캡처 시작, 진행 상황 확인, 중지 시 MP4 저장까지 모두 확장 프로그램 안에서 이루어집니다.

녹화 데이터는 약 2GB 단위로 분할되어 저장됩니다.

![데모](../assets/demo.gif)

## 지원 브라우저

Recordly는 Chromium/Chrome을 대상으로 합니다. Firefox는 지원하지 않습니다.

녹화 데이터를 저장 위치에 직접 기록하는 File System Access API(`showSaveFilePicker`)와 `MediaRecorder`의 MP4 출력을 전제로 하는데, Firefox에서는 이러한 필수 기능을 같은 구성으로 사용할 수 없기 때문입니다.

## 사전 요구 사항

- Node.js >= 22
- pnpm

대신 [mise](https://mise.jdx.dev/)를 사용하면 `mise install`로 툴체인을 설치할 수 있습니다.

## 설치

```bash
pnpm install
```

## 사용 방법

개발 서버를 시작합니다.

```bash
pnpm dev
```

빌드하려면 다음 명령을 사용합니다.

```bash
pnpm build
```

실행 후 브라우저에 확장 프로그램을 로드합니다. 동영상이 있는 페이지에서 확장 프로그램 아이콘을 클릭하고, 팝업의 "이 페이지에서 녹화할 동영상을 선택하세요"로 녹화할 동영상을 선택하세요. 표시된 메뉴에서 "폴더를 선택하고 녹화 시작"으로 저장 위치를 지정해 녹화를 시작합니다. 녹화 중에는 captures 페이지에서 진행 상황을 확인할 수 있으며, 중지하면 지정한 저장 위치에 MP4 저장이 완료됩니다.

## 테스트

공유 로직의 단위 테스트(Vitest)를 실행합니다.

```bash
pnpm test
```

E2E 테스트(Playwright)는 빌드한 확장 프로그램을 실제 브라우저에 로드해 동영상 선택부터 녹화 시작, MP4 저장까지 검증합니다.

```bash
pnpm test:e2e
```

E2E 테스트를 처음 실행하기 전에 Playwright 브라우저를 설치하세요.

```bash
pnpm exec playwright install chromium
```

## 기여

[기여 가이드](../CONTRIBUTING.md)(영어)를 참고하세요.

## 라이선스

[MIT](../../LICENSE)
