# Recordly

[![CI](https://github.com/u1aryz/recordly/actions/workflows/ci.yml/badge.svg)](https://github.com/u1aryz/recordly/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/u1aryz/recordly)](https://github.com/u1aryz/recordly/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Elige cualquier video de una página web, grábalo y guárdalo directamente en disco como MP4 — sin diálogos de compartir pantalla ni pasos de reencodificación.

[English](../../README.md) | [日本語](README_ja.md) | Español | [한국어](README_ko.md) | [简体中文](README_zh-CN.md)

![Demo](../assets/demo.gif)

## Características

- **Haz clic para elegir un video** — selecciona el elemento `<video>` exacto de la página que quieres grabar, sin compartir pestañas ni pantallas.
- **MP4 guardado directamente en disco** — los datos grabados se escriben directamente en el destino que elijas mediante la File System Access API, así que no hay paso de exportación ni reencodificación al detener.
- **Grabaciones largas** — los datos de grabación se dividen en partes de aproximadamente 2 GB cada una, por lo que las sesiones largas son seguras.
- **HUD de grabación y página de progreso** — un HUD en la página durante la grabación, más una página de capturas para el progreso y las descargas.
- **5 idiomas** — English, 日本語, Español, 한국어, 简体中文.

## Instalación

Recordly todavía no está en la Chrome Web Store. Instálalo desde una release:

1. Descarga `recordly-x.x.x-chrome.zip` desde la [última release](https://github.com/u1aryz/recordly/releases/latest) y descomprímelo.
2. Abre `chrome://extensions` y activa el **Modo de desarrollador** (arriba a la derecha).
3. Haz clic en **Cargar descomprimida** y selecciona la carpeta descomprimida.

### Navegadores compatibles

Recordly está dirigido a Chromium/Chrome. Firefox no es compatible: Recordly depende de la File System Access API (`showSaveFilePicker`) para escribir los datos grabados directamente en el destino y de la salida MP4 de `MediaRecorder`, y Firefox no ofrece estas funciones necesarias con la misma configuración.

## Uso

1. En una página con un video, haz clic en el icono de la extensión y usa "**Selecciona un video para grabar en esta página**" en el popup.
2. Haz clic en el video que quieres grabar. En el menú que aparece, elige "**Elegir carpeta y comenzar a grabar**" para indicar el destino e iniciar la grabación.
3. Durante la grabación puedes consultar el progreso en la página de capturas; al detenerla, el MP4 termina de guardarse en el destino elegido.

## Desarrollo

Requisitos previos: Node.js >= 22 y pnpm. Como alternativa, [mise](https://mise.jdx.dev/) puede configurar las herramientas por ti con `mise install`.

```bash
pnpm install
pnpm dev        # Inicia el servidor de desarrollo de WXT para Chromium/Chrome
pnpm build      # Compila la extensión
```

### Pruebas

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

Consulta la [guía de contribución](../CONTRIBUTING.md) (en inglés). Este proyecto sigue el [código de conducta](../../CODE_OF_CONDUCT.md); para informar de una vulnerabilidad, consulta la [política de seguridad](../../SECURITY.md). Recordly no recopila ningún dato de usuario; consulta la [política de privacidad](../../PRIVACY.md) (en inglés).

## Licencia

[MIT](../../LICENSE)
