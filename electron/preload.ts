import { contextBridge, ipcRenderer } from 'electron';
import {
  AppConfig,
  DesktopSourceInfo,
  DiscoveredPeer,
  DisplayInfo,
  ReceiverStatus,
  SelfInfo,
  SignalingMessage,
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
};

contextBridge.exposeInMainWorld('mycast', api);
