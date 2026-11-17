# MyCast — Feature Ideas & Roadmap

Potential new features for **MyCast**, grounded in its current architecture (Electron + React + TypeScript + WebRTC with `iceServers: []`, UDP discovery on port `48899`, HTTP/WebSocket signaling on port `48900`, and `public/web-receiver.html`).

---

## 1. Casting & Media Capabilities

- **Sharp Text / Presentation Mode (`contentHint` & Scaling)**
  - Currently `src/services/webrtcSender.ts` hardcodes `videoTrack.contentHint = 'motion'` and `degradationPreference = 'maintain-framerate'`, which favors smoothness over crisp text.
  - Add a **Content Mode** toggle (**Motion / Gaming** vs. **Detail / Code & Slides** using `'detail'` + `'maintain-resolution'`), plus `1440p`/`4K` and `120 fps` options in `QualityPreset` (`electron/types.ts`).

- **Multi-Receiver Broadcast (1-to-Many)**
  - Currently `WebRtcSenderController` manages a single `RTCPeerConnection` and `electron/signalingServer.ts` tracks one `activeLocalSession` and one `activeSenderId` per web receiver.
  - Fan out one captured `MediaStream` to multiple `RTCPeerConnection` instances to cast simultaneously to multiple PCs or browsers (classrooms, demos, multi-TV setups).

- **Cast Local Video Files & Playlists**
  - Stream a local `.mp4`/`.webm`/`.mkv` file (via `<video>.captureStream()` or direct media streaming) to a receiver without keeping a media player window visible on the sender, complete with play/pause/seek controls.

- **Microphone Mixing & Audio-Only Cast**
  - Currently `captureDesktopStream` only requests desktop loopback audio (`chromeMediaSource: 'desktop'`).
  - Use the Web Audio API to mix **system audio + microphone** (with push-to-talk) for narrated presentations, and add an **Audio-Only** mode so MyCast can act as a wireless speaker receiver.

- **Local Recording & Instant Screenshots**
  - Attach a `MediaRecorder` on either the sender or receiver stream to save casts locally as `.webm`, plus a snapshot button in `src/components/ReceiverView.tsx` and `public/web-receiver.html`.

---

## 2. Interactivity via `RTCDataChannel`

MyCast currently negotiates only audio/video tracks. Opening a WebRTC `RTCDataChannel` enables low-latency two-way features:

- **Opt-In Remote Mouse & Keyboard Control** — Allow the receiver (or sender in reverse) to control cursor/keyboard input for LAN remote desktop or tech support.
- **Virtual Laser Pointer & Screen Annotations** — Draw temporary highlights, arrows, or cursor-click ripples overlaid on the receiver's video without altering the sender's screen.
- **LAN Clipboard Sync & Drag-and-Drop File Transfer** — Send text snippets, URLs, or files directly to the connected receiver over the DataChannel.

---

## 3. Zero-Install Web Receiver Upgrades

- **QR Code Pairing** — Display a scannable QR code next to `webReceiverUrl` in `src/App.tsx` and Ambient Mode in `src/components/ReceiverView.tsx` so phones, tablets, and smart TV browsers can connect without typing an IP.
- **Screen Wake Lock** — Use `navigator.wakeLock.request('screen')` in `public/web-receiver.html` while receiving so tablets/laptops do not dim or sleep mid-cast.
- **PIN Lock for Web Receivers** — Currently `electron/signalingServer.ts` hardcodes `pinRequired: false` for web receivers and skips PIN validation on Flow B. Adding PIN or approval support protects browser targets as well.
- **Host-Level HTTPS (`wss://` / self-signed cert option)** — Enables browser APIs (Wake Lock, Clipboard, fullscreen/touch behavior) that some mobile browsers restrict on plain `http://` LAN origins.

---

## 4. Security, Permissions & Discovery

- **Incoming Cast Approval Dialog & Trusted Devices**
  - Currently `WebRtcReceiverController` (`src/services/webrtcReceiver.ts`) immediately accepts any incoming `cast-request` once any PIN check passes.
  - Add an **Accept / Reject / Always Trust** prompt to prevent unexpected screen takeovers on shared networks.

- **Persistent Manual Peers & Recent Targets**
  - In `electron/discovery.ts`, `manualPeers` is stored only in memory and is lost on restart.
  - Persist manual/favorite peers in `mycast-config.json` so users on VLANs where UDP multicast/broadcast (`239.255.48.90`) is blocked do not need to re-enter IPs.

- **mDNS (`.local`) Discovery & Optional STUN/TURN**
  - Add mDNS/DNS-SD as a discovery fallback, and allow configuring custom `iceServers` (STUN/TURN) in `src/components/SettingsView.tsx` for cross-subnet, VPN (Tailscale/WireGuard), or remote casting.

---

## 5. Desktop UX & Receiver Polish

- **Launch at Startup & Start Minimized to Tray** — Wire `app.setLoginItemSettings` in `electron/main.ts` and add toggles in `src/components/SettingsView.tsx` so living-room/TV PCs stay ready to receive after reboot.
- **Always-on-Top Mini Receiver / Picture-in-Picture Window** — Add a compact borderless `alwaysOnTop` window mode alongside full-window and fullscreen.
- **Global Hotkeys & Floating Cast Toolbar** — Register `globalShortcut` shortcuts in Electron to pause video, mute audio, switch sources, or stop casting without switching back to the MyCast window.
- **Customizable Ambient Mode** — Support custom wallpapers/photo slideshows, 12h/24h clock format, or an auto-hide idle timeout in Ambient Mode.
- **Multi-Sender Split-Screen Grid** — Allow one receiver window to display 2–4 simultaneous casts side by side for comparing screens or monitoring multiple PCs.
