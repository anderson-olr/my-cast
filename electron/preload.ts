import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  AppConfig,
  DesktopSourceInfo,
  DiscoveredPeer,
  DisplayInfo,
  MediaFileInfo,
  ReceiverStatus,
  SavedFileResult,
  SavedPlaylist,
  SelfInfo,
  SignalingMessage,
  SubtitleFileInfo,
} from './types';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  getSelfInfo: (): Promise<SelfInfo> => ipcRenderer.invoke('get-self-info'),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  updateConfig: (patch: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke('update-config', patch),
  regeneratePin: (): Promise<AppConfig> => ipcRenderer.invoke('regenerate-pin'),
  getSources: (): Promise<DesktopSourceInfo[]> => ipcRenderer.invoke('get-sources'),
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('get-displays'),
  getPeers: (): Promise<DiscoveredPeer[]> => ipcRenderer.invoke('get-peers'),
  addManualPeer: (hostOrIp: string, port?: number): Promise<DiscoveredPeer> =>
    ipcRenderer.invoke('add-manual-peer', hostOrIp, port),
  removeManualPeer: (peerId: string): Promise<void> =>
    ipcRenderer.invoke('remove-manual-peer', peerId),
  refreshDiscovery: (): Promise<void> => ipcRenderer.invoke('refresh-discovery'),
  setStatus: (status: ReceiverStatus): Promise<void> => ipcRenderer.invoke('set-status', status),
  enterReceiverFullscreen: (displayId?: number | null): Promise<void> =>
    ipcRenderer.invoke('enter-receiver-fullscreen', displayId),
  exitReceiverFullscreen: (): Promise<void> => ipcRenderer.invoke('exit-receiver-fullscreen'),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('is-fullscreen'),
  sendReceiverSignaling: (msg: SignalingMessage): void => {
    ipcRenderer.send('send-receiver-signaling', msg);
  },
  onPeersUpdated: (cb: (peers: DiscoveredPeer[]) => void) =>
    subscribe<DiscoveredPeer[]>('peers-updated', cb),
  onReceiverSignaling: (cb: (msg: SignalingMessage) => void) =>
    subscribe<SignalingMessage>('receiver-signaling', cb),
  onTrayAction: (cb: (action: 'open-ambient' | 'disconnect-receiver') => void) =>
    subscribe<'open-ambient' | 'disconnect-receiver'>('tray-action', cb),
  onFullscreenChanged: (cb: (isFullscreen: boolean) => void) =>
    subscribe<boolean>('fullscreen-changed', cb),
  onSelfInfoUpdated: (cb: (info: SelfInfo) => void) =>
    subscribe<SelfInfo>('self-info-updated', cb),
  pickMediaFiles: (): Promise<MediaFileInfo[]> => ipcRenderer.invoke('pick-media-files'),
  pickSubtitleFile: (): Promise<SubtitleFileInfo | null> =>
    ipcRenderer.invoke('pick-subtitle-file'),
  readSubtitleFile: (filePath: string): Promise<SubtitleFileInfo> =>
    ipcRenderer.invoke('read-subtitle-file', filePath),
  registerMediaFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('register-media-file', filePath),
  getPlaylists: (): Promise<SavedPlaylist[]> => ipcRenderer.invoke('get-playlists'),
  savePlaylists: (playlists: SavedPlaylist[]): Promise<SavedPlaylist[]> =>
    ipcRenderer.invoke('save-playlists', playlists),
  pickDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('pick-directory', defaultPath),
  saveScreenshot: (dataUrl: string, senderName?: string): Promise<SavedFileResult> =>
    ipcRenderer.invoke('save-screenshot', dataUrl, senderName),
  startRecordingFile: (
    senderName?: string
  ): Promise<{ recordingId: string; filePath: string; fileName: string }> =>
    ipcRenderer.invoke('start-recording-file', senderName),
  appendRecordingChunk: (recordingId: string, chunk: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('append-recording-chunk', recordingId, chunk),
  finishRecordingFile: (recordingId: string): Promise<SavedFileResult> =>
    ipcRenderer.invoke('finish-recording-file', recordingId),
  openFolder: (targetPath: string): Promise<void> => ipcRenderer.invoke('open-folder', targetPath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('mycast', api);
