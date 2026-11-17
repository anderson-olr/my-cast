# AGENTS.md

Guidance for coding agents working in the **MyCast (`my-cast`)** repository.

## Project Overview

MyCast is a Chromecast-style local network (LAN) screen, window, and system audio mirroring application built with **Electron**, **TypeScript**, **React**, **Vite**, and **WebRTC**.

Every running desktop instance acts simultaneously as:
- **Cast Sender**: Discovers receivers on the LAN, captures a screen or app window (with optional Windows desktop loopback audio), and streams via WebRTC.
- **Cast Receiver**: Listens in the background/system tray, optionally enforces a 4-digit PIN, and pops up fullscreen on the target monitor when a cast begins.
- **Zero-Install Web Receiver Host**: Serves `public/web-receiver.html` over HTTP so any browser on the LAN can register as a receiver without installing the desktop app.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start Vite dev server (`http://localhost:5173`), build `electron/`, and launch Electron with hot reload |
| `npm run build` | Type-check and build both renderer (`dist/`) and main/preload (`dist-electron/`) |
| `npm run build:renderer` | Run `tsc --noEmit && vite build` for `src/` |
| `npm run build:electron` | Run `tsc -p tsconfig.node.json` for `electron/` |
| `npm start` | Build everything and launch Electron |
| `npm run pack` | Build and create an unpacked Windows distribution in `release/` via `electron-builder --dir` |

### Multi-Instance Testing on One PC
- Pass `--port <number>` or `--multi` to bypass the single-instance lock (config is isolated per `--port` in `userData/mycast-config-<port>.json`):
  ```powershell
  npx electron . --port 48901
  ```

---

## Repository Structure

```text
my-cast/
├── package.json
├── tsconfig.json                # Renderer TypeScript config (ESNext, bundler, strict)
├── tsconfig.node.json           # Electron main/preload TypeScript config (CommonJS -> dist-electron/)
├── vite.config.ts               # Vite config (base: './', port 5173, outputs to dist/)
├── index.html                   # Renderer HTML shell
├── public/
│   └── web-receiver.html        # Self-contained zero-install browser receiver (HTML/CSS/JS)
├── electron/
│   ├── main.ts                  # App lifecycle, Chromium flags, Tray, IPC, display/fullscreen mgmt
│   ├── preload.ts               # Context-isolated window.mycast IPC bridge
│   ├── discovery.ts             # UDP broadcast + multicast LAN peer discovery & manual /api/info probe
│   ├── signalingServer.ts       # Embedded HTTP + WebSocket (/ws) server & web-receiver relay
│   └── types.ts                 # Backend & IPC shared types
└── src/
    ├── main.tsx                 # React entry point
    ├── App.tsx                  # Root shell, persistent sender/receiver controllers, tab routing
    ├── index.css                # Pure CSS dark glassmorphism design system (no Tailwind)
    ├── types/
    │   └── mycast.d.ts          # Frontend types & Window.mycast declaration
    ├── services/
    │   ├── webrtcSender.ts      # Capture, H.264 preference, SDP bitrate tuning, replaceTrack, stats
    │   └── webrtcReceiver.ts    # Incoming cast lifecycle, playoutDelayHint=0, stats
    └── components/
        ├── Sidebar.tsx          # Left navigation rail & self status footer
        ├── SenderView.tsx       # Peer picker, Loopback card, source thumbnails, quality bar, cast dock
        ├── ReceiverView.tsx     # Ambient standby clock screen, video player, auto-hiding HUD, stats overlay
        └── SettingsView.tsx     # Device name, 4-digit PIN lock, auto-fullscreen, target monitor, tray toggle
```

---

## Architecture & Key Flows

### 1. Network Ports & Discovery (`electron/discovery.ts`, `electron/signalingServer.ts`)
- **UDP `48899`** (`reuseAddr: true`): Broadcasts `MYCAST_BEACON` JSON every `2500 ms` to `255.255.255.255`, active non-virtual subnet broadcast addresses, and multicast group `239.255.48.90`. Peers not seen for `> 8500 ms` are pruned.
- **TCP `48900`** (auto-increments up to 20 attempts on `EADDRINUSE`):
  - `GET /api/info` — Returns receiver metadata (`id`, `name`, `hostname`, `ip`, `port`, `pinRequired`, `status`) with CORS enabled. Used by manual `Add by IP`.
  - `GET /` — Serves `public/web-receiver.html`.
  - `WS /ws` — WebRTC signaling endpoint supporting two flows:
    - **Desktop-to-Desktop**: Sender connects to `ws://<receiver-ip>:<port>/ws?role=sender`. `SignalingServer` validates `pinCode` on `cast-request` before forwarding to the Electron renderer (`receiver-signaling`), so wrong PINs never wake or fullscreen the receiver window.
    - **Desktop-to-Web-Browser Relay**: Browser opens `http://<host-ip>:<port>/` and connects to `/ws?role=web-receiver`. Desktop sender connects to `ws://127.0.0.1:<selfPort>/ws?role=sender&targetClientId=<clientId>` and `SignalingServer` relays messages between them.

### 2. WebRTC Pipeline & Performance (`src/services/webrtcSender.ts`, `src/services/webrtcReceiver.ts`)
- **Codec & Bitrate**: `WebRtcSenderController` prioritizes `video/H264` (`packetization-mode=1`) via `transceiver.setCodecPreferences` for GPU hardware encoding, tunes SDP `b=AS` + `x-google-min/start/max-bitrate`, sets `networkPriority = 'high'`, and sets `degradationPreference = 'maintain-framerate'`.
- **Low-Latency Receiver**: Both `webrtcReceiver.ts` and `public/web-receiver.html` set `receiver.playoutDelayHint = 0` on `ontrack`.
- **System Audio Fallback**: `captureDesktopStream` tries `chromeMediaSource: 'desktop'` for both audio and video; if Windows desktop audio loopback fails (common for single-window captures), it automatically retries video-only and surfaces a non-fatal warning.
- **Live Source Switching**: Mid-cast switching uses `RTCRtpSender.replaceTrack` without tearing down the peer connection.

### 3. Electron Main Process (`electron/main.ts`)
- Chromium switches set before `app.whenReady()`:
  - `autoplay-policy=no-user-gesture-required`
  - `enable-features=WebRtcHideLocalIpsWithMdns:false`
  - `ignore-gpu-blocklist`
- `mainWindow` uses `contextIsolation: true`, `nodeIntegration: false`, and `backgroundThrottling: false` (keeps signaling/capture alive when minimized to the tray).
- Tray icon is generated programmatically via `nativeImage.createFromBuffer` (no `.ico` asset dependency).

---

## Development Conventions & Pitfalls

1. **Keep Types Synchronized**: Any change to IPC payloads, `AppConfig`, `DiscoveredPeer`, `SelfInfo`, `QualityPreset`, or `SignalingMessage` must be updated in both `electron/types.ts` and `src/types/mycast.d.ts` (and exposed in `electron/preload.ts` if crossing IPC).
2. **Keep `public/web-receiver.html` Self-Contained**: Do not introduce external CDN dependencies, React imports, or build-step assets into `public/web-receiver.html`; it is served raw over LAN HTTP (`no-store`). Preserve its muted-autoplay fallback for standard browsers that block unmuted autoplay without user interaction.
3. **Avoid `minFrameRate` on Desktop Capture**: Do not add `minFrameRate` to Chromium `chromeMediaSource: 'desktop'` `mandatory` constraints; Windows DXGI Desktop Duplication stops emitting frames on static screens and `minFrameRate` can trigger `OverconstrainedError`.
4. **Defer `WebSocketServer` Attachment**: In `electron/signalingServer.ts`, keep `new WebSocketServer({ server, path: '/ws' })` inside `server.listen`'s success callback so `EADDRINUSE` is caught by `server` for dynamic port fallback rather than crashing on an unhandled `WebSocketServer` error event.
5. **Styling**: Use CSS variables and classes in `src/index.css`; Tailwind CSS is not installed.
6. **Build Verification**: Always run `npm run build` after modifying either `electron/` or `src/` to verify both `tsc --noEmit && vite build` and `tsc -p tsconfig.node.json` pass cleanly.
