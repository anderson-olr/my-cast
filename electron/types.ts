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

export interface DiscoveryBeacon {
  type: 'MYCAST_BEACON';
  id: string;
  name: string;
  hostname: string;
  ip: string;
  port: number;
  pinRequired: boolean;
  status: ReceiverStatus;
  timestamp: number;
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
  sdp?: unknown;
  candidate?: unknown;
  subtitleText?: string | null;
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
