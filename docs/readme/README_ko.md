# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/u1aryz/recordly)](https://github.com/u1aryz/recordly/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

웹 페이지의 동영상을 선택해 녹화하고 MP4로 디스크에 바로 저장 — 화면 공유 대화 상자도, 다시 인코딩하는 내보내기 단계도 없습니다.

[English](../../README.md) | [日本語](README_ja.md) | [Español](README_es.md) | 한국어 | [简体中文](README_zh-CN.md)

![데모](../assets/demo.gif)

## 특징

- **클릭으로 동영상 선택** — 탭이나 화면 공유가 아니라, 페이지에서 녹화하고 싶은 `<video>` 요소를 그대로 선택할 수 있습니다.
- **MP4를 디스크에 직접 저장** — File System Access API로 녹화 데이터를 선택한 저장 위치에 직접 기록하므로, 중지 시 내보내기나 재인코딩 단계가 없습니다.
- **장시간 녹화 지원** — 녹화 데이터는 약 2GB 단위로 분할 저장되므로 긴 세션도 안전합니다.
- **녹화 HUD와 진행 상황 페이지** — 녹화 중에는 페이지 위 HUD로, 진행 상황과 다운로드는 captures 페이지에서 확인할 수 있습니다.
- **5개 언어 지원** — English, 日本語, Español, 한국어, 简体中文.

## 설치

Recordly는 아직 Chrome Web Store에 공개되지 않았습니다. 릴리스에서 설치하세요.

1. [최신 릴리스](https://github.com/u1aryz/recordly/releases/latest)에서 `recordly-x.x.x-chrome.zip`을 다운로드하고 압축을 풉니다.
2. `chrome://extensions`를 열고 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 클릭하고 압축을 푼 폴더를 선택합니다.

### 지원 브라우저

Recordly는 Chromium/Chrome을 대상으로 합니다. Firefox는 지원하지 않습니다. 녹화 데이터를 저장 위치에 직접 기록하는 File System Access API(`showSaveFilePicker`)와 `MediaRecorder`의 MP4 출력을 전제로 하는데, Firefox에서는 이러한 필수 기능을 같은 구성으로 사용할 수 없기 때문입니다.

## 사용 방법

1. 동영상이 있는 페이지에서 확장 프로그램 아이콘을 클릭하고, 팝업의 "**이 페이지에서 녹화할 동영상을 선택하세요**"를 선택합니다.
2. 녹화할 동영상을 클릭하고, 표시된 메뉴에서 "**폴더를 선택하고 녹화 시작**"으로 저장 위치를 지정해 녹화를 시작합니다.
3. 녹화 중에는 captures 페이지에서 진행 상황을 확인할 수 있습니다. 중지하면 지정한 저장 위치에 MP4 저장이 완료됩니다.

## 개발

사전 요구 사항: Node.js >= 22, pnpm. 대신 [mise](https://mise.jdx.dev/)를 사용하면 `mise install`로 툴체인을 설치할 수 있습니다.

```bash
pnpm install
pnpm dev        # Chromium/Chrome용 WXT 개발 서버 시작
pnpm build      # 확장 프로그램 빌드
```

### 테스트

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

[기여 가이드](../CONTRIBUTING.md)(영어)를 참고하세요. 이 프로젝트는 [행동 강령](../../CODE_OF_CONDUCT.md)을 따릅니다. 취약점 신고는 [보안 정책](../../SECURITY.md)을 참고하세요.

## 라이선스

[MIT](../../LICENSE)
