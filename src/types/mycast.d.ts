export interface QualityPreset {
  resolution: 'native' | '1080p' | '720p';
  fps: 60 | 30;
  bitrateMbps: 3 | 8 | 15 | 30;
  includeAudio: boolean;
}

export interface AppConfig {
  deviceName: string;
  pinRequired: boolean;
  pinCode: string;
  autoFullscreen: boolean;
  targetDisplayId: number | null;
  minimizeToTray: boolean;
  defaultQuality: QualityPreset;
  recordingsDir: string;
  screenshotsDir: string;
}

export type ReceiverStatus = 'idle' | 'casting' | 'receiving';

export interface DiscoveredPeer {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  port: number;
  pinRequired: boolean;
  status: ReceiverStatus;
  lastSeen: number;
  isWebReceiver?: boolean;
  webClientId?: string;
  isManual?: boolean;
  isLoopback?: boolean;
}

export interface DesktopSourceInfo {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
  displayId: string;
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isPrimary: boolean;
}

export interface SelfInfo {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  ips: string[];
  port: number;
  webReceiverUrl: string;
  status: ReceiverStatus;
  pinRequired: boolean;
  pinCode: string;
}

export type SignalingMessageType =
  | 'cast-request'
  | 'cast-accepted'
  | 'cast-rejected'
  | 'webrtc-offer'
  | 'webrtc-answer'
  | 'webrtc-ice'
  | 'cast-stop'
  | 'subtitle-cue';

export interface SignalingMessage {
  type: SignalingMessageType;
  sessionId: string;
  senderId?: string;
  senderName?: string;
  pin?: string;
  reason?: string;
  quality?: QualityPreset;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  subtitleText?: string | null;
}

export interface StreamStats {
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  rttMs: number;
  jitterMs: number;
  codec: string;
  qualityLimitationReason?: string;
}

export interface MediaFileInfo {
  path: string;
  name: string;
  size: number;
}

export interface SubtitleFileInfo {
  path: string;
  name: string;
  content: string;
}

export interface SavedPlaylistItem {
  id: string;
  path: string;
  name: string;
  subtitlePath?: string;
  subtitleName?: string;
}

export interface SavedPlaylist {
  id: string;
  name: string;
  updatedAt: number;
  items: SavedPlaylistItem[];
}

export interface SavedFileResult {
  filePath: string;
  fileName: string;
}

export interface MediaQueueItem {
  id: string;
  path: string;
  name: string;
  size: number;
  mediaUrl: string;
  duration: number;
  width: number;
  height: number;
  thumbnailDataUrl: string | null;
  subtitlePath?: string;
  subtitleName?: string;
  subtitleContent?: string;
  error?: string;
}

export interface MyCastBridge {
  getSelfInfo: () => Promise<SelfInfo>;
  getConfig: () => Promise<AppConfig>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  regeneratePin: () => Promise<AppConfig>;
  getSources: () => Promise<DesktopSourceInfo[]>;
  getDisplays: () => Promise<DisplayInfo[]>;
  getPeers: () => Promise<DiscoveredPeer[]>;
  addManualPeer: (hostOrIp: string, port?: number) => Promise<DiscoveredPeer>;
  removeManualPeer: (peerId: string) => Promise<void>;
  refreshDiscovery: () => Promise<void>;
  setStatus: (status: ReceiverStatus) => Promise<void>;
  enterReceiverFullscreen: (displayId?: number | null) => Promise<void>;
  exitReceiverFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  sendReceiverSignaling: (msg: SignalingMessage) => void;
  onPeersUpdated: (cb: (peers: DiscoveredPeer[]) => void) => () => void;
  onReceiverSignaling: (cb: (msg: SignalingMessage) => void) => () => void;
  onTrayAction: (cb: (action: 'open-ambient' | 'disconnect-receiver') => void) => () => void;
  onFullscreenChanged: (cb: (isFullscreen: boolean) => void) => () => void;
  onSelfInfoUpdated: (cb: (info: SelfInfo) => void) => () => void;
  pickMediaFiles: () => Promise<MediaFileInfo[]>;
  pickSubtitleFile: () => Promise<SubtitleFileInfo | null>;
  readSubtitleFile: (filePath: string) => Promise<SubtitleFileInfo>;
  registerMediaFile: (filePath: string) => Promise<string>;
  getPlaylists: () => Promise<SavedPlaylist[]>;
  savePlaylists: (playlists: SavedPlaylist[]) => Promise<SavedPlaylist[]>;
  pickDirectory: (defaultPath?: string) => Promise<string | null>;
  saveScreenshot: (dataUrl: string, senderName?: string) => Promise<SavedFileResult>;
  startRecordingFile: (
    senderName?: string
  ) => Promise<{ recordingId: string; filePath: string; fileName: string }>;
  appendRecordingChunk: (recordingId: string, chunk: Uint8Array) => Promise<void>;
  finishRecordingFile: (recordingId: string) => Promise<SavedFileResult>;
  openFolder: (targetPath: string) => Promise<void>;
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    mycast: MyCastBridge;
  }

  interface HTMLVideoElement {
    captureStream?(frameRate?: number): MediaStream;
    mozCaptureStream?(frameRate?: number): MediaStream;
  }
}
