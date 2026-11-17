import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DiscoveryService, getLanInterfaces, getPrimaryLanIp } from './discovery';
import { DEFAULT_PORT, SignalingServer } from './signalingServer';
import {
  AppConfig,
  DesktopSourceInfo,
  DiscoveredPeer,
  DisplayInfo,
  ReceiverStatus,
  SelfInfo,
  SignalingMessage,
} from './types';

// Must be called before app is ready so receiver autoplays with audio and WebRTC exposes LAN IPs immediately
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns:false');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

function parseCliPort(): number | undefined {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    const parsed = parseInt(process.argv[idx + 1], 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }
  return undefined;
}

const cliPort = parseCliPort();
const allowMulti = Boolean(cliPort) || process.argv.includes('--multi');
const gotSingleInstanceLock = allowMulti ? true : app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const selfId = crypto.randomUUID();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let currentStatus: ReceiverStatus = 'idle';
let previousWindowBounds: Electron.Rectangle | null = null;

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function createDefaultConfig(): AppConfig {
  return {
    deviceName: os.hostname() || 'MyCast PC',
    pinRequired: false,
    pinCode: generatePin(),
    autoFullscreen: true,
    targetDisplayId: null,
    minimizeToTray: true,
    defaultQuality: {
      resolution: '1080p',
      fps: 60,
      bitrateMbps: 8,
      includeAudio: true,
    },
  };
}

function getConfigPath(): string {
  const suffix = cliPort ? `-${cliPort}` : '';
  return path.join(app.getPath('userData'), `mycast-config${suffix}.json`);
}

let appConfig: AppConfig = createDefaultConfig();

function loadConfig(): AppConfig {
  try {
    const cfgPath = getConfigPath();
    if (fs.existsSync(cfgPath)) {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Partial<AppConfig>;
      const defaults = createDefaultConfig();
      appConfig = {
        ...defaults,
        ...raw,
        defaultQuality: {
          ...defaults.defaultQuality,
          ...(raw.defaultQuality || {}),
        },
      };
      return appConfig;
    }
  } catch (err) {
    console.warn('[Config] Failed to load config, using defaults:', err);
  }
  appConfig = createDefaultConfig();
  saveConfig(appConfig);
  return appConfig;
}

function saveConfig(cfg: AppConfig): void {
  try {
    const cfgPath = getConfigPath();
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Config] Failed to save config:', err);
  }
}

function createCastIconImage(size = 32): Electron.NativeImage {
  const buffer = Buffer.alloc(size * size * 4);
  const cornerRadius = size * 0.22;

  const setPixel = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const idx = (y * size + x) * 4;
    buffer[idx] = r;
    buffer[idx + 1] = g;
    buffer[idx + 2] = b;
    buffer[idx + 3] = a;
  };

  // Draw rounded gradient indigo-blue background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(cornerRadius - x, 0, x - (size - 1 - cornerRadius));
      const dy = Math.max(cornerRadius - y, 0, y - (size - 1 - cornerRadius));
      const dist = Math.hypot(dx, dy);

      if (dist <= cornerRadius) {
        const t = (x + y) / (2 * size);
        const r = Math.round(59 + t * 40);
        const g = Math.round(92 - t * 20);
        const b = Math.round(246 - t * 5);
        const alpha = dist > cornerRadius - 1 ? Math.round((cornerRadius - dist) * 255) : 255;
        setPixel(x, y, r, g, b, Math.max(0, Math.min(255, alpha)));
      }
    }
  }

  // Draw white screen outline & cast arcs
  const left = Math.round(size * 0.2);
  const right = Math.round(size * 0.8);
  const top = Math.round(size * 0.24);
  const bottom = Math.round(size * 0.72);
  const stroke = Math.max(2, Math.round(size * 0.08));

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const onTop = y < top + stroke;
      const onRight = x > right - stroke;
      const onBottom = y > bottom - stroke && x > left + size * 0.35;
      const onLeft = x < left + stroke && y < top + size * 0.2;
      if (onTop || onRight || onBottom || onLeft) {
        setPixel(x, y, 255, 255, 255, 255);
      }
    }
  }

  // Draw cast waves in bottom-left corner
  const originX = left;
  const originY = bottom;
  for (let y = top; y <= bottom + 2; y++) {
    for (let x = left - 1; x <= right; x++) {
      const d = Math.hypot(x - originX, originY - y);
      if (
        d <= size * 0.1 ||
        (d >= size * 0.17 && d <= size * 0.24 && x >= originX && y <= originY) ||
        (d >= size * 0.31 && d <= size * 0.38 && x >= originX && y <= originY)
      ) {
        setPixel(x, y, 255, 255, 255, 255);
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

let signalingServer: SignalingServer;
let discoveryService: DiscoveryService;

function getSelfInfo(): SelfInfo {
  const ip = getPrimaryLanIp();
  const ips = getLanInterfaces().map((i) => i.ip);
  const port = signalingServer ? signalingServer.getPort() : cliPort || DEFAULT_PORT;

  return {
    id: selfId,
    name: appConfig.deviceName,
    hostname: os.hostname(),
    ip,
    ips: ips.length > 0 ? ips : [ip],
    port,
    webReceiverUrl: `http://${ip}:${port}`,
    status: currentStatus,
    pinRequired: appConfig.pinRequired,
    pinCode: appConfig.pinCode,
  };
}

function getMergedPeers(): DiscoveredPeer[] {
  const lanPeers = discoveryService ? discoveryService.getPeers() : [];
  const webPeers = signalingServer ? signalingServer.getWebReceiverPeers() : [];
  return [...webPeers, ...lanPeers];
}

function broadcastPeersToRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('peers-updated', getMergedPeers());
  }
}

function broadcastSelfInfoToRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('self-info-updated', getSelfInfo());
  }
}

function updateTrayMenu(): void {
  if (!tray) return;
  const info = getSelfInfo();
  const statusLabel =
    currentStatus === 'receiving'
      ? 'Receiving Stream'
      : currentStatus === 'casting'
        ? 'Casting Screen'
        : 'Ready (Idle)';

  const menu = Menu.buildFromTemplate([
    { label: `${info.name} (${info.ip}:${info.port})`, enabled: false },
    { label: `Status: ${statusLabel}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open MyCast',
      click: () => {
        showAndFocusWindow();
      },
    },
    {
      label: 'Open Ambient Receiver',
      click: () => {
        showAndFocusWindow();
        mainWindow?.webContents.send('tray-action', 'open-ambient');
      },
    },
    {
      label: 'Disconnect Active Stream',
      enabled: currentStatus === 'receiving',
      click: () => {
        signalingServer?.disconnectActiveLocalReceiver('Disconnected from System Tray');
        mainWindow?.webContents.send('tray-action', 'disconnect-receiver');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit MyCast',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip(`MyCast — ${info.name} (${info.ip}:${info.port})`);
  tray.setContextMenu(menu);
}

function showAndFocusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function getDisplaysList(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, index) => ({
    id: d.id,
    label:
      d.label ||
      `Display ${index + 1} (${d.bounds.width}×${d.bounds.height})${d.id === primaryId ? ' — Primary' : ''}`,
    bounds: d.bounds,
    isPrimary: d.id === primaryId,
  }));
}

function enterReceiverFullscreen(displayId?: number | null): void {
  if (!mainWindow) return;

  if (!mainWindow.isFullScreen()) {
    previousWindowBounds = mainWindow.getBounds();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();

  const allDisplays = screen.getAllDisplays();
  const targetId = displayId ?? appConfig.targetDisplayId;
  const targetDisplay =
    (targetId ? allDisplays.find((d) => d.id === targetId) : undefined) ||
    screen.getPrimaryDisplay();

  if (targetDisplay) {
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
    const { x, y, width, height } = targetDisplay.bounds;
    mainWindow.setBounds({
      x: x + Math.round(width * 0.1),
      y: y + Math.round(height * 0.1),
      width: Math.min(1200, Math.round(width * 0.8)),
      height: Math.min(720, Math.round(height * 0.8)),
    });
  }

  mainWindow.moveTop();
  mainWindow.focus();
  mainWindow.setFullScreen(true);
}

function exitReceiverFullscreen(): void {
  if (!mainWindow) return;
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
  if (previousWindowBounds) {
    mainWindow.setBounds(previousWindowBounds);
    previousWindowBounds = null;
  }
}

async function createMainWindow(): Promise<void> {
  const appIcon = createCastIconImage(32);

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'MyCast',
    icon: appIcon,
    backgroundColor: '#0b0f19',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-changed', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-changed', false);
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && appConfig.minimizeToTray) {
      event.preventDefault();
      if (mainWindow?.isFullScreen()) {
        mainWindow.setFullScreen(false);
      }
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  tray = new Tray(createCastIconImage(16));
  tray.on('double-click', () => {
    showAndFocusWindow();
  });
  updateTrayMenu();
}

function registerIpcHandlers(): void {
  ipcMain.handle('get-self-info', () => getSelfInfo());
  ipcMain.handle('get-config', () => appConfig);

  ipcMain.handle('update-config', (_event, patch: Partial<AppConfig>) => {
    appConfig = {
      ...appConfig,
      ...patch,
      defaultQuality: {
        ...appConfig.defaultQuality,
        ...(patch.defaultQuality || {}),
      },
    };
    saveConfig(appConfig);
    discoveryService?.sendBeacon();
    updateTrayMenu();
    broadcastSelfInfoToRenderer();
    return appConfig;
  });

  ipcMain.handle('regenerate-pin', () => {
    appConfig = {
      ...appConfig,
      pinCode: generatePin(),
    };
    saveConfig(appConfig);
    discoveryService?.sendBeacon();
    updateTrayMenu();
    broadcastSelfInfoToRenderer();
    return appConfig;
  });

  ipcMain.handle('get-sources', async (): Promise<DesktopSourceInfo[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });

    return sources
      .filter((s) => s.name && s.thumbnail)
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnailDataUrl: s.thumbnail.toDataURL(),
        appIconDataUrl: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        displayId: s.display_id,
      }));
  });

  ipcMain.handle('get-displays', () => getDisplaysList());
  ipcMain.handle('get-peers', () => getMergedPeers());

  ipcMain.handle('add-manual-peer', async (_event, hostOrIp: string, port?: number) => {
    const peer = await discoveryService.probeManualPeer(hostOrIp, port);
    broadcastPeersToRenderer();
    return peer;
  });

  ipcMain.handle('remove-manual-peer', (_event, peerId: string) => {
    discoveryService.removeManualPeer(peerId);
  });

  ipcMain.handle('refresh-discovery', () => {
    discoveryService.sendBeacon();
    broadcastPeersToRenderer();
  });

  ipcMain.handle('set-status', (_event, status: ReceiverStatus) => {
    currentStatus = status;
    discoveryService?.sendBeacon();
    updateTrayMenu();
    broadcastSelfInfoToRenderer();
  });

  ipcMain.handle('enter-receiver-fullscreen', (_event, displayId?: number | null) => {
    enterReceiverFullscreen(displayId);
  });

  ipcMain.handle('exit-receiver-fullscreen', () => {
    exitReceiverFullscreen();
  });

  ipcMain.handle('toggle-fullscreen', () => {
    if (!mainWindow) return false;
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });

  ipcMain.handle('is-fullscreen', () => {
    return mainWindow?.isFullScreen() ?? false;
  });

  ipcMain.on('send-receiver-signaling', (_event, msg: SignalingMessage) => {
    signalingServer?.sendToLocalSender(msg);
  });
}

if (!allowMulti) {
  app.on('second-instance', () => {
    showAndFocusWindow();
  });
}

app.whenReady().then(async () => {
  loadConfig();

  signalingServer = new SignalingServer({
    selfId,
    getConfig: () => appConfig,
    getStatus: () => currentStatus,
    preferredPort: cliPort || DEFAULT_PORT,
  });

  const boundPort = await signalingServer.start();
  console.log(`[MyCast] HTTP/WebSocket signaling listening on port ${boundPort}`);

  discoveryService = new DiscoveryService({
    selfId,
    getBeaconInfo: () => ({
      name: appConfig.deviceName,
      port: signalingServer.getPort(),
      pinRequired: appConfig.pinRequired,
      status: currentStatus,
    }),
  });

  discoveryService.on('peers-updated', () => {
    broadcastPeersToRenderer();
  });

  signalingServer.on('web-receivers-updated', () => {
    broadcastPeersToRenderer();
  });

  signalingServer.on('receiver-signaling', (msg: SignalingMessage) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('receiver-signaling', msg);
    }
  });

  await discoveryService.start();

  registerIpcHandlers();
  await createMainWindow();
  updateTrayMenu();
});

app.on('before-quit', () => {
  isQuitting = true;
  discoveryService?.stop();
  signalingServer?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !appConfig.minimizeToTray) {
    app.quit();
  }
});

app.on('activate', () => {
  showAndFocusWindow();
});
