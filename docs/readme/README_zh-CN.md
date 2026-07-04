# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

[English](../../README.md) | [日本語](README_ja.md) | [Español](README_es.md) | [한국어](README_ko.md) | 简体中文

## 概述

Recordly 是一个浏览器扩展,用于选择网页上的视频、进行捕获并保存结果。

选择视频、指定保存位置、开始捕获、查看进度、停止时保存 MP4,这一切都在扩展内完成。

录制数据会按大约每 2GB 分割保存。

![演示](../assets/demo.gif)

## 支持的浏览器

Recordly 面向 Chromium/Chrome。不支持 Firefox。

它依赖 File System Access API(`showSaveFilePicker`)将录制数据直接写入保存位置,并依赖 `MediaRecorder` 的 MP4 输出;Firefox 无法以相同配置提供这些必需的功能。

## 前置条件

- Node.js >= 22
- pnpm

或者,也可以使用 [mise](https://mise.jdx.dev/) 通过 `mise install` 配置工具链。

## 安装

```bash
pnpm install
```

## 使用方法

启动开发服务器:

```bash
pnpm dev
```

构建时使用以下命令:

```bash
pnpm build
```

启动后,将扩展加载到浏览器中。在有视频的页面上点击扩展图标,通过弹出窗口中的"选择此页面上要录制的视频"选择要录制的视频。在出现的菜单中选择"选择文件夹并开始录制",指定保存位置并开始录制。录制过程中可以在 captures 页面查看进度;停止后,MP4 将保存到指定的位置。

## 测试

运行共享逻辑的单元测试(Vitest):

```bash
pnpm test
```

E2E 测试(Playwright)会将构建好的扩展加载到真实浏览器中,验证从选择视频到开始录制、保存 MP4 的完整流程。

```bash
pnpm test:e2e
```

首次运行 E2E 测试前,请先安装 Playwright 浏览器:

```bash
pnpm exec playwright install chromium
```

## 贡献

请参阅[贡献指南](../CONTRIBUTING.md)(英文)。

## 许可证

[MIT](../../LICENSE)
