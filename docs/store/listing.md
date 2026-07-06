# Chrome Web Store listing

Draft copy and checklists for the Chrome Web Store listing. Paste these into the
[developer dashboard](https://chrome.google.com/webstore/devconsole) when creating or
updating the item. Keep this file in sync with `public/_locales/*/messages.json`,
`docs/PRIVACY.md`, and the manifest permissions — reviewers cross-check all three.

## Basics

- **Item name**: Recordly
- **Category**: Tools
- **Language**: English (default) + Japanese, Spanish, Korean, Simplified Chinese
- **Privacy policy URL**: `https://github.com/u1aryz/recordly/blob/main/docs/PRIVACY.md`
- **Homepage URL**: `https://github.com/u1aryz/recordly`
- **Support URL**: `https://github.com/u1aryz/recordly/issues`

## Short description (max 132 characters)

| Locale | Copy |
| --- | --- |
| en | Pick any video on a web page, record it, and save it straight to disk as MP4 — no screen sharing, no re-encoding. |
| ja | ページ上の動画をクリックで選んで録画し、MP4 のままディスクへ直接保存。画面共有も再エンコードも不要です。 |
| es | Elige un video en la página, grábalo y guárdalo directamente en disco como MP4, sin compartir pantalla ni recodificar. |
| ko | 페이지의 동영상을 선택해 녹화하고 재인코딩 없이 MP4로 디스크에 바로 저장합니다. 화면 공유가 필요 없습니다. |
| zh_CN | 选择网页上的视频进行录制，直接以 MP4 保存到磁盘，无需屏幕共享，也无需重新编码。 |

## Detailed description

Plain text (the dashboard does not render Markdown).

### en

```
Recordly lets you pick the exact <video> element on a web page, record it, and save it straight to your disk as MP4.

FEATURES
• Click to pick a video — select the exact video on the page you want to record; no tab or screen sharing dialogs.
• MP4, saved directly to disk — recorded data streams straight to the folder you choose via the File System Access API, so there is no export or re-encoding step when you stop.
• Long recordings — recording data is split into parts of roughly 2 GB each, so lengthy sessions are safe.
• Recording HUD and progress page — an on-page HUD while recording, plus a captures page for progress and history.
• 5 languages — English, 日本語, Español, 한국어, 简体中文.

HOW TO USE
1. On a page with a video, click the extension icon and choose "Select a video to record on this page".
2. Click the video you want to record, then choose a destination folder to start recording.
3. Stop from the on-page HUD; the MP4 finishes saving to the chosen folder immediately.

PRIVACY
Recordly collects no data. Recordings, capture history, and settings never leave your device. See the privacy policy for details.

NOTES
• Requires Chrome/Chromium (uses the File System Access API and MP4 output from MediaRecorder).
• DRM-protected videos cannot be captured.
• Open source (MIT): https://github.com/u1aryz/recordly
```

### ja

```
Recordly は、ページ上の <video> 要素をクリックで選んで録画し、MP4 のままディスクへ直接保存できる拡張機能です。

主な機能
• クリックで動画を選択 — タブや画面の共有ダイアログなしで、録画したい動画そのものを選べます。
• MP4 をディスクへ直接保存 — File System Access API で選択したフォルダへ録画データを直接書き込むため、停止後の書き出しや再エンコードはありません。
• 長時間録画 — 録画データは約 2GB ごとに分割保存されるため、長時間のセッションも安全です。
• 録画 HUD とキャプチャページ — 録画中はページ上に HUD を表示し、キャプチャページで進行状況と履歴を確認できます。
• 5 言語対応 — English、日本語、Español、한국어、简体中文。

使い方
1. 動画のあるページで拡張機能アイコンをクリックし、「このページで録画する動画を選択」を選びます。
2. 録画したい動画をクリックし、保存先フォルダを選ぶと録画が始まります。
3. ページ上の HUD から停止すると、MP4 は選択したフォルダに即座に保存されます。

プライバシー
Recordly はデータを一切収集しません。録画データ・履歴・設定が端末の外へ送信されることはありません。詳細はプライバシーポリシーをご覧ください。

注意
• Chrome/Chromium が必要です(File System Access API と MediaRecorder の MP4 出力を使用)。
• DRM で保護された動画はキャプチャできません。
• オープンソース(MIT): https://github.com/u1aryz/recordly
```

### es

```
Recordly te permite elegir el elemento <video> exacto de una página web, grabarlo y guardarlo directamente en tu disco como MP4.

CARACTERÍSTICAS
• Elige un video con un clic: selecciona el video exacto que quieres grabar, sin diálogos de compartir pestaña o pantalla.
• MP4 guardado directamente en disco: los datos grabados se escriben directamente en la carpeta que elijas mediante la File System Access API, sin exportación ni recodificación al detener.
• Grabaciones largas: los datos se dividen en partes de aproximadamente 2 GB, por lo que las sesiones largas son seguras.
• HUD de grabación y página de progreso: un HUD en la página mientras grabas, más una página de capturas con progreso e historial.
• 5 idiomas: English, 日本語, Español, 한국어, 简体中文.

CÓMO USAR
1. En una página con un video, haz clic en el icono de la extensión y elige "Seleccionar un video para grabar en esta página".
2. Haz clic en el video que quieres grabar y elige una carpeta de destino para comenzar.
3. Detén la grabación desde el HUD; el MP4 se termina de guardar inmediatamente en la carpeta elegida.

PRIVACIDAD
Recordly no recopila ningún dato. Las grabaciones, el historial y la configuración nunca salen de tu dispositivo. Consulta la política de privacidad para más detalles.

NOTAS
• Requiere Chrome/Chromium (usa la File System Access API y la salida MP4 de MediaRecorder).
• No se pueden capturar videos protegidos por DRM.
• Código abierto (MIT): https://github.com/u1aryz/recordly
```

### ko

```
Recordly는 웹 페이지의 <video> 요소를 직접 선택해 녹화하고, MP4 그대로 디스크에 바로 저장하는 확장 프로그램입니다.

주요 기능
• 클릭으로 동영상 선택 — 탭이나 화면 공유 대화 상자 없이 녹화할 동영상을 직접 선택합니다.
• MP4를 디스크에 직접 저장 — File System Access API로 선택한 폴더에 녹화 데이터를 바로 기록하므로, 중지 후 내보내기나 재인코딩이 없습니다.
• 장시간 녹화 — 녹화 데이터가 약 2GB 단위로 분할 저장되어 긴 세션도 안전합니다.
• 녹화 HUD와 캡처 페이지 — 녹화 중에는 페이지 위 HUD로, 캡처 페이지에서는 진행 상황과 기록을 확인할 수 있습니다.
• 5개 언어 지원 — English, 日本語, Español, 한국어, 简体中文.

사용 방법
1. 동영상이 있는 페이지에서 확장 프로그램 아이콘을 클릭하고 "이 페이지에서 녹화할 동영상 선택"을 선택합니다.
2. 녹화할 동영상을 클릭한 뒤 저장할 폴더를 선택하면 녹화가 시작됩니다.
3. 페이지의 HUD에서 중지하면 MP4가 선택한 폴더에 즉시 저장됩니다.

개인정보 보호
Recordly는 어떤 데이터도 수집하지 않습니다. 녹화 데이터, 기록, 설정은 기기 밖으로 전송되지 않습니다. 자세한 내용은 개인정보 처리방침을 참고하세요.

참고
• Chrome/Chromium이 필요합니다(File System Access API와 MediaRecorder의 MP4 출력 사용).
• DRM으로 보호된 동영상은 캡처할 수 없습니다.
• 오픈 소스(MIT): https://github.com/u1aryz/recordly
```

### zh_CN

```
Recordly 让你直接选择网页上的 <video> 元素进行录制，并将其以 MP4 格式直接保存到磁盘。

主要功能
• 点击选择视频 — 无需标签页或屏幕共享对话框，直接选中想录制的视频。
• MP4 直接保存到磁盘 — 通过 File System Access API 将录制数据直接写入你选择的文件夹，停止后无需导出或重新编码。
• 长时间录制 — 录制数据按约 2GB 分段保存，长时间录制也安全可靠。
• 录制 HUD 与进度页面 — 录制时在页面上显示 HUD，并可在捕获页面查看进度和历史记录。
• 支持 5 种语言 — English、日本語、Español、한국어、简体中文。

使用方法
1. 在包含视频的页面上点击扩展图标，选择"选择要在此页面上录制的视频"。
2. 点击想录制的视频，选择保存文件夹后即开始录制。
3. 通过页面上的 HUD 停止录制，MP4 会立即保存到所选文件夹。

隐私
Recordly 不收集任何数据。录制内容、历史记录和设置都不会离开你的设备。详情请参阅隐私政策。

说明
• 需要 Chrome/Chromium(使用 File System Access API 和 MediaRecorder 的 MP4 输出)。
• 无法捕获受 DRM 保护的视频。
• 开源(MIT):https://github.com/u1aryz/recordly
```

## Graphics

Generated by `pnpm store:assets` (see `e2e/store/`). Regenerate after UI changes.
On macOS the extension UI language follows the OS setting, so force English while
generating (same caveat as `pnpm demo:record`, see `e2e/fixtures.ts`):

```bash
defaults write com.google.chrome.for.testing AppleLanguages '("en-US")'
pnpm store:assets
defaults delete com.google.chrome.for.testing AppleLanguages
```

| Asset | Size | Path |
| --- | --- | --- |
| Store icon | 128x128 | `public/icon/128.png` |
| Screenshots (up to 5) | 1280x800 | `docs/store/screenshots/*.png` |
| Small promo tile | 440x280 | `docs/store/promo/small-tile.png` |
| Marquee promo tile (optional) | 1400x560 | `docs/store/promo/marquee.png` |

## Privacy practices tab

### Single purpose

> Recordly has a single purpose: record a user-selected HTML5 video element on the
> current page and save it locally as an MP4 file.

### Permission justifications

| Permission | Justification (paste into dashboard) |
| --- | --- |
| `tabs` | Used to find the active tab when the popup opens, send start/stop messages to the tab being recorded, open the extension's captures page, and store the page URL/title in the local capture history. No browsing data is transmitted anywhere. |
| `storage` | Stores user settings locally (HUD position, resolution-change behavior) via chrome.storage.local. |
| Host permission `<all_urls>` | The video picker and recording HUD are provided by a content script that must run on whichever page contains the video the user wants to record. Users can invoke recording on any site, so access cannot be limited to a fixed host list. The content script only locates <video> elements and renders its own UI; it does not read, store, or transmit page content. |
| Remote code | Not used. All code is bundled in the extension package. |

### Data usage declarations

- Check **none** of the data categories (no data is collected).
- Certify: does not sell or transfer user data to third parties; does not use or
  transfer user data for purposes unrelated to the single purpose; does not use or
  transfer user data to determine creditworthiness or for lending purposes.

## First publish (manual, one-time)

> **Done.** Recordly is published at
> <https://chromewebstore.google.com/detail/recordly/jgaachkpbgimobjldcgfappghbhmhdak>
> (extension ID: `jgaachkpbgimobjldcgfappghbhmhdak`). The steps below are kept for
> reference.

1. Verify the developer account contact email in the dashboard (Account tab).
2. Build the package: `pnpm zip` → `output/recordly-<version>-chrome.zip`.
3. Dashboard → **New item** → upload the zip. Note the generated **extension ID**.
4. Fill in the store listing (copy above), upload icon/screenshots/promo tiles, and
   add the localized descriptions for ja/es/ko/zh_CN via "Add another language".
5. Fill in the Privacy practices tab (copy above) and set the privacy policy URL.
6. Distribution: visibility **Public**, all regions.
7. Submit for review. With `<all_urls>` host permissions, expect an in-depth review
   (typically a few days, occasionally longer).
8. After approval: update the Install section of `README.md` (and `docs/readme/*`)
   to link to the store listing instead of the load-unpacked instructions.

## Automated publishing (after first publish)

Subsequent releases are submitted automatically by `.github/workflows/release.yml`
on `v*` tags using `wxt submit`. The submit step is skipped until the secrets below
are configured.

1. Generate Chrome Web Store API credentials — `pnpm wxt submit init` walks through
   creating a Google Cloud project, enabling the Chrome Web Store API, creating an
   OAuth client, and obtaining a refresh token. It writes `.env.submit` (gitignored)
   for local use.
2. Test locally: `pnpm zip && pnpm wxt submit --dry-run --chrome-zip output/*-chrome.zip`.
3. Add GitHub repository secrets (Settings → Secrets and variables → Actions):
   - `CHROME_EXTENSION_ID` — the ID from the dashboard item
   - `CHROME_CLIENT_ID` / `CHROME_CLIENT_SECRET` — the OAuth client
   - `CHROME_REFRESH_TOKEN` — from `wxt submit init`
4. Tag a release (`git tag v0.0.5 && git push --tags`). The workflow zips, uploads to
   the Chrome Web Store, and submits for review; the version is published automatically
   once the review passes.

Note: the refresh token expires if unused for ~6 months, and re-authorizing rotates
it. If the submit step starts failing with auth errors, regenerate via
`pnpm wxt submit init` and update the secret.
