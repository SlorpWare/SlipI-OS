# SlipI-OS
its a web os, based on daedalos, but will use CheerpX as the Linux engine rather than slow v86

## Browser Application API

Applications are independent HTML files with assets referenced relative to their own HTML file. The desktop loads each app in an iframe. Launch flags are query parameters, so they do not change relative asset resolution:

```text
Applications/example/index.html?--is_windowed&--window_size=640x720
```

Use the desktop's Open app button or call `window.WebOS.openApp(url, options)`. App options support `title`, `icon`, `isWindowed`, `windowSize`, `width`, and `height`. The host also exposes `openWindow`, `openFileManager`, `getWindows`, `closeWindow`, `minimizeWindow`, `maximizeWindow`, `resizeWindow`, and async filesystem methods under `window.WebOS.filesystem`.

An app under `WebOS filesystem/Applications/<app>/` can load `../../app-api.js`. It exposes `window.WebOSApp.flags` (`isWindowed`, `windowSize`, and `windowId`) and `openApp`, `close`, `minimize`, `maximize`, `resize`, `setTitle`, and `setIcon`. App-to-host requests use `postMessage` and are accepted only from registered app iframes.

The API example is at `WebOS filesystem/Applications/api-example/index.html`. The Nuvola icon theme is extracted to `WebOS filesystem/Icons/nuvola/`; attribution and license notices are included with the theme.

## Xelite File Manager

Xelite is built into the desktop shell and is not an HTML file inside the browsable filesystem. It uses BrowserFS 1.4.3 with `AsyncMirror` and the IndexedDB backend (`slipi-os-browserfs`) for persistent browser storage. On first run, `filesystem-manifest.json` seeds the application/system files into the BrowserFS root, excluding the Nuvola icon pack.

`Application files`, `Applications`, and `Linux files` are read-only system paths. The Nuvola icon pack remains a static UI asset outside the user filesystem; it is not seeded into BrowserFS. `Public` and `Trash` are writable. **Import folder** copies selected folder contents into `Public`; file imports go to the current writable folder. This is a one-way seed/copy: browser pages cannot directly mount or modify the workspace directory. User changes persist in IndexedDB and do not write back to the workspace folder.

Xelite supports folder navigation, sorting, text-file editing, file/folder creation, rename, delete, upload, download, and folder import. The built-in manager itself is not stored in the user filesystem, so deleting files cannot remove Xelite.

## Application Dock

Dock launchers are `.ini` files in the writable `/Dock` directory. Each launcher uses a `[Desktop Entry]` section with `Name`, `Exec`, and optional `Icon` and `WindowSize` keys. The dock polls this directory for changes; icons reference static assets and are not copied into the user filesystem. `Exec=builtin:xelite` launches the integrated file manager; `/Applications/<app>/index.html` launches the bundled HTML app.
