# Pin Float

Pin Float turns images into small always-on-top windows that you can move, resize and overlay.

## What you can do with it

- Keep a design reference on screen while you build the page in a browser or editor.
- Compare two versions of a site by pinning a screenshot of one next to the other.
- Lower the opacity of a pinned mockup, place it over a live page and line them up pixel by pixel with the arrow keys.
- Turn on click-through so the pin stays visible while you keep working in the window underneath.

## Requirements

- Windows. The app has only been built and used on Windows, and some parts are Windows-specific: the shortcut script (`scripts/create-shortcut.ps1`), pinning a file copied in File Explorer, and the 32px edge tab workaround. Electron also runs on macOS and Linux, but Pin Float has not been tested there.
- Node.js with npm, to install Electron 44 (`electron ^44.4.3` in `package.json`).

## Install and run

```
npm i
npm start
```

There is no packaged build or installer. The app runs from the project folder through the Electron binary in `node_modules`.

To get a desktop and Start menu shortcut that opens the app without a console window, run this once:

```
pwsh scripts/create-shortcut.ps1
```

The shortcut points to the current project folder. If you move the folder, run the script again. The shortcut icon is `build/icon.ico`. To redraw it (and `build/icon.png`), run `node build/make-icon.js`.

The app lives in the system tray as a purple icon. Closing all pins does not quit it. Use **Quit** in the tray menu. Only one instance runs at a time. Starting it again passes the command line to the running instance.

## Usage

### Pin an image

- **Edge tab:** a thin purple strip on the left edge of the primary display. Drag an image onto it from a browser, Figma or File Explorer. A drop zone opens, and the image opens as a pin when you drop it.
- **Clipboard:** copy an image (for example right-click it in a browser and choose "Copy image"), then press `Ctrl+Alt+V`, click the edge tab, or choose **Pin image from clipboard** in the tray menu. This also works with a screenshot, an image file copied in File Explorer, and an image URL or file path copied as text.
- **Replace:** drop an image onto an existing pin to replace its image.
- **Command line:** see below.

There is no open file dialog.

Dropped content can be an image file, an image inside HTML (the `<img src>` is used), an `http(s)` URL, a `data:` URL, a `file:` URL or a Windows file path. Supported formats: PNG, JPEG, GIF, WebP, BMP, SVG, AVIF and ICO.

A new pin opens centered on the mouse pointer, at its natural size or smaller so that it fits in 45% of the screen.

### Global shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+V` | Pin the image on the clipboard |
| `Ctrl+Alt+X` | Turn click-through on or off for all pins |

If another app already uses one of these, Pin Float shows a notification.

### Pin window

| Action | How |
|---|---|
| Move | Drag with the left mouse button |
| Nudge | Arrow keys move 1px, `Shift` + arrow keys move 10px |
| Resize | Mouse wheel zooms in steps of 10% and keeps the point under the cursor in place. Dragging an edge or corner also works. The aspect ratio is kept. The wheel stops at 80px wide |
| Actual size | Double-click. Double-click again to go back to the previous size |
| Opacity | `Ctrl` + mouse wheel changes it in steps of 5%. Keys `1` to `9` set 10% to 90%, `0` sets 100%. Minimum is 10% |
| Copy | `Ctrl+C` copies the image to the clipboard as PNG |
| Close | `Esc`, or the close button in the top right corner (shown on hover, hidden on very small pins) |
| Menu | Right-click |

The pin menu has: Copy, Save as… (saves the original file, default folder is Pictures), Actual size or Previous size, Opacity (100%, 80%, 60%, 50%, 40%, 20%), Click-through and Close.

While click-through is on, pins ignore the mouse and clicks go to the window below. Press `Ctrl+Alt+X` or use the tray menu to turn it off.

### Edge tab

- Hover: the strip grows into a tab.
- Click: pins the image on the clipboard.
- Right-click: opens the same menu as the tray icon.
- Drag an image over it: opens the drop zone.

### Tray menu

- Pin image from clipboard
- Click-through for all pins
- Close all pins
- Edge tab: Left or Right, Top, Middle or Bottom, Hide
- Start with Windows
- Quit

### Command line

These also work while the app is running. The second instance passes them to the first one.

```
npx electron . --pin-clipboard
npx electron . "--pin=C:\images\reference.png"
```

The value must be joined to the key with `=`, because Chromium reorders arguments in the second instance.

For debugging, set `PF_DEBUG=1` to print main process logs. In that mode, `--dock-state=open`, `--dock-state=peek` or `--dock-state=thin` forces the edge tab into that state, so you can check its look without dragging anything.

## Settings and state

Edge tab settings (side, position, hidden) are saved to `settings.json` in the Electron user data folder. On Windows that is `%APPDATA%\pin-float\settings.json`. "Start with Windows" is stored as a login item by the operating system. Pins are not saved. They are gone after you quit.

## Known limitations

- Windows does not open a frameless window narrower than 32px, so part of the edge tab window sits off screen. If you have another display to the left of the primary one, the hidden part shows up there. Move the tab to the right side in that case.
- The edge tab is only shown on the primary display.
- Some sites block image downloads from other apps (hotlink protection), so dropping an image from them can fail. Copy the image in the browser and use `Ctrl+Alt+V` instead.
- Opacity and size are not remembered between pins or sessions.

## License

MIT. See [LICENSE](LICENSE).
