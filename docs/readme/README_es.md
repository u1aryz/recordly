# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

[English](../../README.md) | [日本語](README_ja.md) | Español | [한국어](README_ko.md) | [简体中文](README_zh-CN.md)

## Descripción general

Recordly es una extensión de navegador para seleccionar videos en una página web, capturarlos y guardar el resultado.

Seleccionar un video, elegir el destino, iniciar la captura, consultar el progreso y guardar el MP4 al detener: todo ocurre dentro de la extensión.

Los datos de grabación se guardan divididos en partes de aproximadamente 2 GB cada una.

![Demo](../assets/demo.gif)

## Navegadores compatibles

Recordly está dirigido a Chromium/Chrome. Firefox no es compatible.

Depende de la File System Access API (`showSaveFilePicker`) para escribir los datos grabados directamente en el destino y de la salida MP4 de `MediaRecorder`; Firefox no ofrece estas funciones necesarias con la misma configuración.

## Requisitos previos

- Node.js >= 22
- pnpm

Como alternativa, [mise](https://mise.jdx.dev/) puede configurar las herramientas por ti con `mise install`.

## Instalación

```bash
pnpm install
```

## Uso

Inicia el servidor de desarrollo:

```bash
pnpm dev
```

Para compilar, usa:

```bash
pnpm build
```

Una vez en marcha, carga la extensión en el navegador. En una página con un video, haz clic en el icono de la extensión y usa "Selecciona un video para grabar en esta página" en el popup para elegir el video que quieres grabar. En el menú que aparece, elige "Elegir carpeta y comenzar a grabar" para indicar el destino e iniciar la grabación. Durante la grabación puedes consultar el progreso en la página de capturas; al detenerla, el MP4 termina de guardarse en el destino elegido.

## Pruebas

Ejecuta las pruebas unitarias de la lógica compartida (Vitest):

```bash
pnpm test
```

Las pruebas E2E (Playwright) cargan la extensión compilada en un navegador real y verifican todo el flujo, desde seleccionar un video hasta iniciar la grabación y guardar el MP4.

```bash
pnpm test:e2e
```

Antes de ejecutar las pruebas E2E por primera vez, instala el navegador de Playwright:

```bash
pnpm exec playwright install chromium
```

## Contribuir

Consulta la [guía de contribución](../CONTRIBUTING.md) (en inglés).

## Licencia

[MIT](../../LICENSE)
