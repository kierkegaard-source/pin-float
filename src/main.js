const {
  app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, clipboard, ClipboardItem,
  nativeImage, screen, net, Notification, dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');

const SHORTCUT_PIN = 'CommandOrControl+Alt+V';
const SHORTCUT_THROUGH = 'CommandOrControl+Alt+X';

// The edge tab has three states: a thin strip, a clickable tab on hover, and a drop zone while dragging.
const DOCK_SIZES = {
  thin: { w: 8, h: 120 },
  peek: { w: 44, h: 132 },
  open: { w: 210, h: 240 },
};

const PRELOAD = path.join(__dirname, 'preload.js');
const MIN_W = 80;
const WIN_MIN_W = 32;
const log = (...a) => { if (process.env.PF_DEBUG) console.log('[pf]', ...a); };

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// --- Settings ----------------------------------------------------------------

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { side: 'left', dockY: 0.5, dockHidden: false };

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {}
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch {}
}

// --- Helpers -------------------------------------------------------------------

function notify(body) {
  if (Notification.isSupported()) new Notification({ title: 'Pin Float', body, silent: true }).show();
}

function displayAtCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function clampToArea(b, area) {
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - Math.min(b.width, area.width));
  const y = Math.min(Math.max(b.y, area.y), area.y + area.height - Math.min(b.height, area.height));
  return { ...b, x: Math.round(x), y: Math.round(y) };
}

function sniffMime(buf) {
  const b = buf.subarray(0, 32);
  const ascii = b.toString('latin1');
  if (b[0] === 0x89 && ascii.startsWith('PNG', 1)) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('BM')) return 'image/bmp';
  if (ascii.slice(4, 12) === 'ftypavif') return 'image/avif';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  if (/<svg[\s>]/i.test(buf.subarray(0, 2048).toString('utf8'))) return 'image/svg+xml';
  return null;
}

function asImage(bytes, hint) {
  const buf = Buffer.from(bytes);
  const mime = sniffMime(buf) || (hint && hint.startsWith('image/') ? hint : null);
  return mime ? { bytes: buf, mime } : null;
}

function readImageFile(p) {
  try {
    return asImage(fs.readFileSync(p));
  } catch {
    return null;
  }
}

async function fetchImage(url) {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) return null;
    const data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    return asImage(data, m[1]);
  }
  if (url.startsWith('file:')) return readImageFile(fileURLToPath(url));
  if (/^[a-z]:[\\/]/i.test(url)) return readImageFile(url);
  if (!/^https?:/i.test(url)) return null;

  const u = new URL(url);
  const res = await net.fetch(url, {
    headers: { Referer: `${u.origin}/`, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return asImage(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type'));
}

// Returns the first image that can be opened from a drop payload: files first, then URLs.
async function resolvePayload({ files = [], urls = [] }) {
  for (const f of files) {
    const img = asImage(f.bytes, f.type);
    if (img) return img;
  }
  for (const url of urls) {
    try {
      const img = await fetchImage(url);
      if (img) return img;
    } catch {}
  }
  return null;
}

const OS_FORMAT = (name) => `electron application/osclipboard;format="${name}"`;

async function blobBytes(item, type) {
  const blob = await item.getType(type);
  return Buffer.from(await blob.arrayBuffer());
}

// Electron 44 moved the clipboard to an async, W3C-like API (no readImage/readBuffer):
// clipboard.read() returns items with MIME types, and raw Windows formats come through OS_FORMAT.
async function readClipboardImage() {
  const items = await clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith('image/'));
    if (imageType) {
      const img = asImage(await blobBytes(item, imageType), imageType);
      if (!img) continue;
      // An image copied from a browser is in its own pixels. A screenshot is in display scale.
      const fromWeb = item.types.includes('text/html') || item.types.includes(OS_FORMAT('Chromium internal source URL'));
      return { ...img, scale: fromWeb ? 1 : displayAtCursor().scaleFactor };
    }

    // A file copied in File Explorer
    if (item.types.includes(OS_FORMAT('FileNameW'))) {
      const p = (await blobBytes(item, OS_FORMAT('FileNameW'))).toString('utf16le').split('\0')[0];
      const fromFile = readImageFile(p);
      if (fromFile) return fromFile;
    }

    // No image data: fall back to <img src> in the HTML or a plain text URL
    const urls = [];
    if (item.types.includes('text/html')) {
      const html = (await blobBytes(item, 'text/html')).toString('utf8');
      const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
      if (m) urls.push(m[1].replace(/&amp;/g, '&'));
    }
    if (item.types.includes('text/plain')) urls.push((await blobBytes(item, 'text/plain')).toString('utf8').trim());
    const img = await resolvePayload({ urls: urls.filter(Boolean) });
    if (img) return img;
  }
  return null;
}

// --- Floating windows ------------------------------------------------------------

const pins = new Map(); // webContents.id -> state
let clickThrough = false;

function pinOf(event) {
  return pins.get(event.sender.id);
}

function createPin(image, at) {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#161616',
    width: 320,
    height: 240,
    minWidth: 48,
    minHeight: 32,
    title: 'Pin',
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.setVisualZoomLevelLimits(1, 1);

  const state = { win, image, natural: null, prevBounds: null, drag: null, placeAt: at, fresh: true };
  pins.set(win.webContents.id, state);
  log('pin created', image.mime, image.bytes.length);
  win.webContents.on('console-message', (e) => log('pin console', e.message));
  const id = win.webContents.id;
  win.on('closed', () => pins.delete(id));

  win.loadFile(path.join(__dirname, 'pin.html'));
  win.webContents.once('did-finish-load', () => sendImage(state));
  if (clickThrough) win.setIgnoreMouseEvents(true);
  return state;
}

function sendImage(state) {
  const { bytes, mime } = state.image;
  state.win.webContents.send('pin:image', { bytes, mime });
}

// Places the window once the natural size of the image (in DIP) is known.
function placePin(state, px) {
  const scale = state.image.scale || 1;
  state.natural = { w: px.w / scale, h: px.h / scale };
  const { win } = state;
  const ratio = state.natural.w / state.natural.h;

  let center;
  if (state.fresh) {
    center = state.placeAt || screen.getCursorScreenPoint();
  } else {
    const b = win.getBounds();
    center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  const area = screen.getDisplayNearestPoint(center).workArea;
  const k = Math.min(1, (area.width * 0.45) / state.natural.w, (area.height * 0.45) / state.natural.h);
  let w = state.natural.w * k;
  if (w < MIN_W) w = MIN_W;
  const h = w / ratio;

  win.setAspectRatio(ratio);
  win.setBounds(clampToArea({
    x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2),
    width: Math.round(w), height: Math.round(h),
  }, area));
  state.prevBounds = null;
  if (state.fresh) {
    state.fresh = false;
    win.show();
  }
}

ipcMain.on('pin:ready', (e, px) => {
  const state = pinOf(e);
  log('pin ready', px);
  if (state) placePin(state, px);
});

ipcMain.on('pin:failed', (e) => {
  const state = pinOf(e);
  if (!state) return;
  notify('Could not open this image.');
  if (state.fresh) state.win.destroy();
});

ipcMain.on('pin:drag-start', (e) => {
  const state = pinOf(e);
  if (!state) return;
  const c = screen.getCursorScreenPoint();
  const b = state.win.getBounds();
  state.drag = { dx: c.x - b.x, dy: c.y - b.y, w: b.width, h: b.height };
});

ipcMain.on('pin:drag-move', (e) => {
  const state = pinOf(e);
  if (!state?.drag) return;
  const c = screen.getCursorScreenPoint();
  const d = state.drag;
  // On scaled displays setPosition can change the window size, so the size is passed explicitly.
  state.win.setBounds({ x: c.x - d.dx, y: c.y - d.dy, width: d.w, height: d.h });
});

ipcMain.on('pin:drag-end', (e) => {
  const state = pinOf(e);
  if (state) state.drag = null;
});

ipcMain.on('pin:nudge', (e, dx, dy) => {
  const state = pinOf(e);
  if (!state) return;
  const b = state.win.getBounds();
  state.win.setBounds({ ...b, x: b.x + dx, y: b.y + dy });
});

// Wheel: zooms in or out while the point under the cursor stays in place.
ipcMain.handle('pin:zoom', (e, dir, cx, cy) => {
  const state = pinOf(e);
  if (!state?.natural) return null;
  const b = state.win.getBounds();
  const ratio = state.natural.w / state.natural.h;
  const f = dir < 0 ? 1.1 : 1 / 1.1;
  const w = Math.min(Math.max(b.width * f, MIN_W), 10000);
  const h = w / ratio;
  const k = w / b.width;
  state.win.setBounds({
    x: Math.round(b.x + cx * (1 - k)), y: Math.round(b.y + cy * (1 - k)),
    width: Math.round(w), height: Math.round(h),
  });
  return Math.round((w / state.natural.w) * 100);
});

ipcMain.handle('pin:opacity', (e, value, relative) => {
  const state = pinOf(e);
  if (!state) return null;
  const next = Math.min(1, Math.max(0.1, relative ? state.win.getOpacity() + value : value));
  state.win.setOpacity(next);
  return Math.round(next * 100);
});

function toggleActualSize(state) {
  if (!state.natural) return;
  const { win } = state;
  if (state.prevBounds) {
    win.setBounds(state.prevBounds);
    state.prevBounds = null;
    return;
  }
  const b = win.getBounds();
  state.prevBounds = b;
  const w = Math.round(state.natural.w);
  const h = Math.round(state.natural.h);
  win.setBounds({
    x: Math.round(b.x + b.width / 2 - w / 2), y: Math.round(b.y + b.height / 2 - h / 2),
    width: w, height: h,
  });
}

ipcMain.handle('pin:actual-size', (e) => {
  const state = pinOf(e);
  if (!state) return null;
  toggleActualSize(state);
  return Math.round((state.win.getBounds().width / state.natural.w) * 100);
});

ipcMain.on('pin:close', (e) => pinOf(e)?.win.close());

ipcMain.handle('pin:write-clipboard', async (_e, png) => {
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
});

async function savePin(state) {
  const ext = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/x-icon': 'ico' }[state.image.mime]
    || state.image.mime.split('/')[1];
  const { canceled, filePath } = await dialog.showSaveDialog(state.win, {
    defaultPath: path.join(app.getPath('pictures'), `pin-${Date.now()}.${ext}`),
  });
  if (!canceled && filePath) fs.writeFileSync(filePath, state.image.bytes);
}

ipcMain.on('pin:menu', (e) => {
  const state = pinOf(e);
  if (!state) return;
  const op = Math.round(state.win.getOpacity() * 100);
  const setOp = (v) => {
    state.win.setOpacity(v / 100);
    state.win.webContents.send('pin:flash', `${v}% opacity`);
  };
  Menu.buildFromTemplate([
    { label: 'Copy', accelerator: 'Ctrl+C', click: () => state.win.webContents.send('pin:do', 'copy') },
    { label: 'Save as…', click: () => savePin(state) },
    { type: 'separator' },
    { label: state.prevBounds ? 'Previous size' : 'Actual size', click: () => toggleActualSize(state) },
    {
      label: `Opacity (${op}%)`,
      submenu: [100, 80, 60, 50, 40, 20].map((v) => ({
        label: `${v}%`, type: 'radio', checked: op === v, click: () => setOp(v),
      })),
    },
    { label: 'Click-through', accelerator: SHORTCUT_THROUGH, click: () => setClickThrough(true) },
    { type: 'separator' },
    { label: 'Close', accelerator: 'Esc', click: () => state.win.close() },
  ]).popup({ window: state.win });
});

function setClickThrough(on) {
  clickThrough = on;
  for (const { win } of pins.values()) {
    win.setIgnoreMouseEvents(on);
    win.webContents.send('pin:through', on);
  }
  refreshTray();
  if (on && pins.size) notify(`Pins now let clicks through. Press ${SHORTCUT_THROUGH.replace('CommandOrControl', 'Ctrl')} to turn this off.`);
}

// --- Ways to open an image ---------------------------------------------------------

async function pinFromPayload(payload, target) {
  const image = await resolvePayload(payload);
  if (!image) {
    notify('Could not find an image in what was dropped.');
    return;
  }
  if (target) {
    target.image = image;
    sendImage(target);
  } else {
    createPin(image, screen.getCursorScreenPoint());
  }
}

async function pinFromClipboard() {
  log('pinFromClipboard');
  let image = null;
  try {
    image = await readClipboardImage();
  } catch (err) {
    log('clipboard error', err);
  }
  if (!image) {
    notify('No image on the clipboard. Right-click an image and choose "Copy image".');
    return;
  }
  createPin(image, screen.getCursorScreenPoint());
}

ipcMain.on('drop:payload', (e, payload) => {
  const target = pins.get(e.sender.id) || null;
  pinFromPayload(payload, target);
  if (!target) setDockState('thin');
});

ipcMain.on('clipboard:pin', () => pinFromClipboard());

// --- Edge tab --------------------------------------------------------------------------

let dock = null;
let dockState = 'thin';

function dockBounds(kind) {
  const area = screen.getPrimaryDisplay().workArea;
  const s = DOCK_SIZES[kind];
  // Windows will not open this window narrower than 32px. The extra width sits off screen, so s.w stays visible.
  const width = Math.max(s.w, WIN_MIN_W);
  const hidden = width - s.w;
  const x = settings.side === 'left' ? area.x - hidden : area.x + area.width - s.w;
  const y = Math.round(area.y + area.height * settings.dockY - s.h / 2);
  return { x, y, width, height: s.h };
}

function setDockState(kind) {
  if (!dock || dockState === kind) return;
  dockState = kind;
  dock.setBounds(dockBounds(kind));
  dock.webContents.send('dock:state', kind);
}

function createDock() {
  dock = new BrowserWindow({
    ...(({ x, y, width, height }) => ({ x, y, width, height }))(dockBounds('thin')),
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    transparent: true,
    hasShadow: false,
    thickFrame: false,
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
  });
  dock.setAlwaysOnTop(true, 'screen-saver');
  dock.loadFile(path.join(__dirname, 'dock.html'));
  dock.webContents.on('console-message', (e) => log('dock console', e.message));
  dock.webContents.once('did-finish-load', () => {
    dock.webContents.send('dock:side', settings.side);
    if (!settings.dockHidden) dock.showInactive();
  });
}

function repositionDock() {
  if (!dock) return;
  dock.setBounds(dockBounds(dockState));
  dock.webContents.send('dock:side', settings.side);
}

ipcMain.on('dock:state', (_e, kind) => {
  if (DOCK_SIZES[kind]) setDockState(kind);
});

ipcMain.on('dock:menu', () => trayMenu().popup({ window: dock }));

// --- Tray -------------------------------------------------------------------------

let tray = null;

// The tray icon is drawn in code: a white frame inside a rounded purple square.
function trayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const inRound = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      let c = null;
      if (inRound(px, py, 1, 1, 31, 31, 7)) c = [0xf2, 0x5c, 0x7c]; // BGR: #7c5cf2
      if (inRound(px, py, 8, 10, 24, 23, 2) && !inRound(px, py, 10.5, 12.5, 21.5, 20.5, 1)) c = [255, 255, 255];
      if (inRound(px, py, 13, 5, 19, 10, 1.5)) c = [255, 255, 255];
      if (c) {
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

function loginItemArgs() {
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

function trayMenu() {
  const shortcut = (s) => s.replace('CommandOrControl', 'Ctrl');
  const openAtLogin = app.getLoginItemSettings(loginItemArgs()).openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'Pin image from clipboard', accelerator: shortcut(SHORTCUT_PIN), click: pinFromClipboard },
    {
      label: 'Click-through for all pins', type: 'checkbox', checked: clickThrough,
      accelerator: shortcut(SHORTCUT_THROUGH), click: (item) => setClickThrough(item.checked),
    },
    { label: `Close all pins (${pins.size})`, enabled: pins.size > 0, click: () => pins.forEach((p) => p.win.close()) },
    { type: 'separator' },
    {
      label: 'Edge tab',
      submenu: [
        { label: 'Left', type: 'radio', checked: settings.side === 'left', click: () => setSide('left') },
        { label: 'Right', type: 'radio', checked: settings.side === 'right', click: () => setSide('right') },
        { type: 'separator' },
        { label: 'Top', type: 'radio', checked: settings.dockY === 0.25, click: () => setDockY(0.25) },
        { label: 'Middle', type: 'radio', checked: settings.dockY === 0.5, click: () => setDockY(0.5) },
        { label: 'Bottom', type: 'radio', checked: settings.dockY === 0.75, click: () => setDockY(0.75) },
        { type: 'separator' },
        { label: 'Hide', type: 'checkbox', checked: settings.dockHidden, click: (i) => setDockHidden(i.checked) },
      ],
    },
    {
      label: 'Start with Windows', type: 'checkbox', checked: openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, ...loginItemArgs() }),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(trayMenu());
}

function setSide(side) {
  settings.side = side;
  saveSettings();
  repositionDock();
  refreshTray();
}

function setDockY(y) {
  settings.dockY = y;
  saveSettings();
  repositionDock();
  refreshTray();
}

function setDockHidden(hidden) {
  settings.dockHidden = hidden;
  saveSettings();
  if (hidden) dock?.hide();
  else dock?.showInactive();
  refreshTray();
}

// --- Command line: `electron . --pin-clipboard` or `electron . --pin=<file>` -------------
// Chromium reorders arguments in the second instance, so the value must be joined to the key with `=`.

function argValue(argv, name) {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1).replace(/^"|"$/g, '') : null;
}

function handleArgs(argv) {
  log('args', argv);
  const ds = argValue(argv, '--dock-state');
  if (process.env.PF_DEBUG && ds) setDockState(ds);
  if (argv.includes('--pin-clipboard')) pinFromClipboard();
  const file = argValue(argv, '--pin');
  if (file) {
    const image = readImageFile(file);
    if (image) createPin(image);
    else notify(`Could not open: ${file}`);
  }
}

app.on('second-instance', (_e, argv) => handleArgs(argv));

app.whenReady().then(() => {
  app.setAppUserModelId('Pin Float');
  loadSettings();
  createDock();

  tray = new Tray(trayIcon());
  tray.setToolTip('Pin Float');
  refreshTray();
  tray.on('click', () => tray.popUpContextMenu(trayMenu()));
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));

  const failed = [
    [SHORTCUT_PIN, pinFromClipboard],
    [SHORTCUT_THROUGH, () => setClickThrough(!clickThrough)],
  ].filter(([accel, fn]) => !globalShortcut.register(accel, fn)).map(([accel]) => accel);
  log('shortcuts', { failed, pin: globalShortcut.isRegistered(SHORTCUT_PIN) });
  if (failed.length) notify(`Shortcut already in use by another app: ${failed.join(', ')}`);

  screen.on('display-metrics-changed', repositionDock);
  screen.on('display-added', repositionDock);
  screen.on('display-removed', repositionDock);

  handleArgs(process.argv);
});

app.on('window-all-closed', () => {}); // keep running in the tray
app.on('will-quit', () => globalShortcut.unregisterAll());
