import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Globe, Laptop, RefreshCw } from 'lucide-react';
import { Sidebar, NavTab } from './components/Sidebar';
import { SenderView } from './components/SenderView';
import { ReceiverView } from './components/ReceiverView';
import { SettingsView } from './components/SettingsView';
import { WebRtcSenderController } from './services/webrtcSender';
import { WebRtcReceiverController } from './services/webrtcReceiver';
import {
  AppConfig,
  DesktopSourceInfo,
  DiscoveredPeer,
  DisplayInfo,
  QualityPreset,
  SelfInfo,
  StreamStats,
} from './types/mycast';

const DEFAULT_QUALITY: QualityPreset = {
  resolution: '1080p',
  fps: 60,
  bitrateMbps: 8,
  includeAudio: true,
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('cast');
  const [selfInfo, setSelfInfo] = useState<SelfInfo | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [sources, setSources] = useState<DesktopSourceInfo[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sender state
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityPreset>(DEFAULT_QUALITY);
  const [pinInput, setPinInput] = useState('');
  const [castState, setCastState] = useState<'stopped' | 'connecting' | 'casting'>('stopped');
  const [videoPaused, setVideoPaused] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [senderStats, setSenderStats] = useState<StreamStats | null>(null);
  const [senderWarning, setSenderWarning] = useState<string | null>(null);
  const [senderError, setSenderError] = useState<string | null>(null);

  // Receiver state
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [receiverSenderName, setReceiverSenderName] = useState('');
  const [receiverStats, setReceiverStats] = useState<StreamStats | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const configRef = useRef<AppConfig | null>(null);
  const selfInfoRef = useRef<SelfInfo | null>(null);
  const activeTabRef = useRef<NavTab>('cast');
  const tabBeforeCastRef = useRef<NavTab>('cast');
  const enteredFullscreenForCastRef = useRef(false);
  const castStateRef = useRef<'stopped' | 'connecting' | 'casting'>('stopped');

  configRef.current = config;
  selfInfoRef.current = selfInfo;
  activeTabRef.current = activeTab;
  castStateRef.current = castState;

  const senderRef = useRef<WebRtcSenderController | null>(null);
  const receiverRef = useRef<WebRtcReceiverController | null>(null);

  const refreshSources = useCallback(async () => {
    try {
      const list = await window.mycast.getSources();
      setSources(list);
      setSelectedSourceId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        const primaryScreen = list.find((s) => s.type === 'screen');
        return primaryScreen?.id || list[0]?.id || null;
      });
    } catch (err) {
      console.error('Failed to load capture sources:', err);
    }
  }, []);

  const refreshDisplays = useCallback(async () => {
    try {
      const list = await window.mycast.getDisplays();
      setDisplays(list);
    } catch (err) {
      console.error('Failed to load displays:', err);
    }
  }, []);

  useEffect(() => {
    senderRef.current = new WebRtcSenderController({
      onStateChange: (nextState, message) => {
        setCastState(nextState);
        if (nextState === 'casting') {
          setVideoPaused(false);
          setAudioMuted(false);
          window.mycast.setStatus('casting').catch(() => {});
        } else if (nextState === 'stopped') {
          setSenderStats(null);
          setVideoPaused(false);
          setAudioMuted(false);
          window.mycast.setStatus('idle').catch(() => {});
          if (message && !message.includes('Stopped by sender')) {
            setSenderWarning(message);
          }
        }
      },
      onStats: (stats) => {
        setSenderStats(stats);
      },
      onWarning: (msg) => {
        setSenderWarning(msg);
      },
      onError: (msg) => {
        setSenderError(msg);
      },
    });

    receiverRef.current = new WebRtcReceiverController({
      onIncomingCast: ({ senderId, senderName }) => {
        const isLoopback = Boolean(senderId && selfInfoRef.current && senderId === selfInfoRef.current.id);
        tabBeforeCastRef.current = activeTabRef.current;
        setReceiverSenderName(senderName);
        setActiveTab('receiver');

        if (!isLoopback) {
          window.mycast.setStatus('receiving').catch(() => {});
          if (configRef.current?.autoFullscreen) {
            enteredFullscreenForCastRef.current = true;
            window.mycast
              .enterReceiverFullscreen(configRef.current.targetDisplayId)
              .catch(() => {});
          }
        }
      },
      onStream: (stream) => {
        setRemoteStream(stream);
      },
      onStats: (stats) => {
        setReceiverStats(stats);
      },
      onCastEnded: () => {
        setRemoteStream(null);
        setReceiverStats(null);
        setReceiverSenderName('');

        if (enteredFullscreenForCastRef.current) {
          enteredFullscreenForCastRef.current = false;
          window.mycast.exitReceiverFullscreen().catch(() => {});
        }

        window.mycast
          .setStatus(castStateRef.current === 'casting' ? 'casting' : 'idle')
          .catch(() => {});

        if (tabBeforeCastRef.current !== 'receiver') {
          setActiveTab(tabBeforeCastRef.current);
        }
      },
    });

    return () => {
      senderRef.current?.stopCast(false);
      receiverRef.current?.disconnect('App closed');
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const [info, cfg, initialPeers, full] = await Promise.all([
        window.mycast.getSelfInfo(),
        window.mycast.getConfig(),
        window.mycast.getPeers(),
        window.mycast.isFullscreen(),
      ]);
      if (!mounted) return;
      setSelfInfo(info);
      setConfig(cfg);
      setQuality(cfg.defaultQuality || DEFAULT_QUALITY);
      setPeers(initialPeers);
      setIsFullscreen(full);

      if (initialPeers.length > 0) {
        setSelectedPeerId(initialPeers[0].id);
      }

      await Promise.all([refreshSources(), refreshDisplays()]);
    }

    init();

    const unsubPeers = window.mycast.onPeersUpdated((nextPeers) => {
      setPeers(nextPeers);
      setSelectedPeerId((prev) => {
        if (prev === '__loopback__') return prev;
        if (prev && nextPeers.some((p) => p.id === prev)) return prev;
        return nextPeers[0]?.id || prev;
      });
    });

    const unsubSelf = window.mycast.onSelfInfoUpdated((info) => {
      setSelfInfo(info);
    });

    const unsubFs = window.mycast.onFullscreenChanged((fs) => {
      setIsFullscreen(fs);
    });

    const unsubSignaling = window.mycast.onReceiverSignaling((msg) => {
      receiverRef.current?.handleSignalingMessage(msg).catch((err) => {
        console.error('Receiver signaling error:', err);
      });
    });

    const unsubTray = window.mycast.onTrayAction((action) => {
      if (action === 'open-ambient') {
        setActiveTab('receiver');
      } else if (action === 'disconnect-receiver') {
        receiverRef.current?.disconnect('Disconnected from System Tray');
      }
    });

    return () => {
      mounted = false;
      unsubPeers();
      unsubSelf();
      unsubFs();
      unsubSignaling();
      unsubTray();
    };
  }, [refreshSources, refreshDisplays]);

  const handleQualityChange = useCallback(
    async (next: QualityPreset) => {
      setQuality(next);
      if (castState === 'casting') {
        senderRef.current?.updateQuality(next);
      }
      await window.mycast.updateConfig({ defaultQuality: next });
    },
    [castState]
  );

  const handleStartCast = useCallback(async () => {
    if (!selfInfo || !selectedSourceId || !senderRef.current) return;

    const target: DiscoveredPeer | undefined =
      selectedPeerId === '__loopback__'
        ? {
            id: '__loopback__',
            name: `${selfInfo.name} (Loopback Test)`,
            hostname: selfInfo.hostname,
            ip: '127.0.0.1',
            port: selfInfo.port,
            pinRequired: selfInfo.pinRequired,
            status: 'idle',
            lastSeen: Date.now(),
            isLoopback: true,
          }
        : peers.find((p) => p.id === selectedPeerId);

    if (!target) return;

    setSenderError(null);
    setSenderWarning(null);

    try {
      await senderRef.current.startCast({
        target,
        sourceId: selectedSourceId,
        quality,
        selfId: selfInfo.id,
        selfName: selfInfo.name,
        selfPort: selfInfo.port,
        pin: target.pinRequired ? pinInput : undefined,
      });
    } catch {
      // Error already surfaced via onError callback
    }
  }, [selfInfo, selectedPeerId, selectedSourceId, peers, quality, pinInput]);

  const handleStopCast = useCallback(() => {
    senderRef.current?.stopCast(true, 'Stopped by sender');
  }, []);

  const handleSwitchSource = useCallback(async (sourceId: string) => {
    try {
      await senderRef.current?.switchSource(sourceId);
    } catch (err) {
      setSenderError(err instanceof Error ? err.message : 'Failed to switch capture source');
    }
  }, []);

  const handleToggleVideoPaused = useCallback(() => {
    setVideoPaused((prev) => {
      const next = !prev;
      senderRef.current?.setVideoPaused(next);
      return next;
    });
  }, []);

  const handleToggleAudioMuted = useCallback(() => {
    setAudioMuted((prev) => {
      const next = !prev;
      senderRef.current?.setAudioMuted(next);
      return next;
    });
  }, []);

  const handleAddManualPeer = useCallback(async (hostOrIp: string) => {
    const peer = await window.mycast.addManualPeer(hostOrIp);
    setSelectedPeerId(peer.id);
  }, []);

  const handleRemoveManualPeer = useCallback(async (peerId: string) => {
    await window.mycast.removeManualPeer(peerId);
  }, []);

  const handleUpdateConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const updated = await window.mycast.updateConfig(patch);
    setConfig(updated);
  }, []);

  const handleRegeneratePin = useCallback(async () => {
    const updated = await window.mycast.regeneratePin();
    setConfig(updated);
  }, []);

  const handleMoveToDisplay = useCallback(async (displayId: number) => {
    await window.mycast.updateConfig({ targetDisplayId: displayId });
    await window.mycast.enterReceiverFullscreen(displayId);
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    await window.mycast.toggleFullscreen();
  }, []);

  const webReceivers = useMemo(() => peers.filter((p) => p.isWebReceiver), [peers]);

  const copyWebUrl = useCallback(() => {
    if (!selfInfo) return;
    navigator.clipboard.writeText(selfInfo.webReceiverUrl).then(() => {
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1800);
    });
  }, [selfInfo]);

  const hideSidebar = isFullscreen && activeTab === 'receiver';

  return (
    <div className="app-shell">
      {!hideSidebar && (
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          selfInfo={selfInfo}
          peerCount={peers.length}
          webReceiverCount={webReceivers.length}
          isCasting={castState === 'casting'}
          isReceiving={Boolean(remoteStream)}
        />
      )}

      <main className="main-content">
        {activeTab === 'cast' && (
          <SenderView
            selfInfo={selfInfo}
            peers={peers}
            sources={sources}
            selectedPeerId={selectedPeerId}
            onSelectPeer={setSelectedPeerId}
            selectedSourceId={selectedSourceId}
            onSelectSource={setSelectedSourceId}
            quality={quality}
            onChangeQuality={handleQualityChange}
            pinInput={pinInput}
            onChangePinInput={setPinInput}
            castState={castState}
            videoPaused={videoPaused}
            audioMuted={audioMuted}
            stats={senderStats}
            warning={senderWarning}
            error={senderError}
            onDismissWarning={() => setSenderWarning(null)}
            onDismissError={() => setSenderError(null)}
            onRefreshPeers={() => window.mycast.refreshDiscovery()}
            onRefreshSources={refreshSources}
            onAddManualPeer={handleAddManualPeer}
            onRemoveManualPeer={handleRemoveManualPeer}
            onStartCast={handleStartCast}
            onStopCast={handleStopCast}
            onSwitchSource={handleSwitchSource}
            onToggleVideoPaused={handleToggleVideoPaused}
            onToggleAudioMuted={handleToggleAudioMuted}
          />
        )}

        {activeTab === 'receiver' && (
          <ReceiverView
            selfInfo={selfInfo}
            stream={remoteStream}
            senderName={receiverSenderName}
            stats={receiverStats}
            displays={displays}
            targetDisplayId={config?.targetDisplayId ?? null}
            isFullscreen={isFullscreen}
            onToggleFullscreen={handleToggleFullscreen}
            onMoveToDisplay={handleMoveToDisplay}
            onDisconnect={() => receiverRef.current?.disconnect('Disconnected by receiver')}
            onExitToCast={() => setActiveTab('cast')}
          />
        )}

        {activeTab === 'web' && (
          <div className="scroll-view">
            <div className="page-header">
              <div>
                <h1 className="page-title">Zero-Install Web Browser Receiver</h1>
                <p className="page-subtitle">
                  Cast to any second PC, Mac, Linux machine, or tablet on your Wi-Fi/LAN without installing software on it.
                </p>
              </div>
            </div>

            <section className="section-card">
              <div className="section-title-group">
                <Globe size={18} color="#34d399" />
                <h2 className="section-title">Browser Receiver URL</h2>
              </div>

              <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Open the address below in Chrome, Edge, or Firefox on the target PC. As soon as the page loads, it automatically registers as a receiver in your <strong>Cast Screen</strong> tab.
              </p>

              {selfInfo && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '16px 20px',
                    borderRadius: '12px',
                    background: 'rgba(7, 10, 18, 0.72)',
                    border: '1px solid var(--border-strong)',
                    flexWrap: 'wrap',
                  }}
                >
                  <code
                    style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#a5b4fc',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {selfInfo.webReceiverUrl}
                  </code>
                  <button className="btn btn-primary" onClick={copyWebUrl}>
                    {copiedUrl ? <Check size={15} /> : <Copy size={15} />}
                    <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </div>
              )}

              {selfInfo && selfInfo.ips.length > 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    All detected local network addresses:
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {selfInfo.ips.map((ip) => (
                      <span key={ip} className="tag">
                        http://{ip}:{selfInfo.port}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="section-card">
              <div className="section-header">
                <div className="section-title-group">
                  <Laptop size={18} color="#818cf8" />
                  <h2 className="section-title">
                    Connected Browser Receivers ({webReceivers.length})
                  </h2>
                </div>
                <button className="btn btn-sm" onClick={() => window.mycast.refreshDiscovery()}>
                  <RefreshCw size={14} />
                  <span>Refresh</span>
                </button>
              </div>

              {webReceivers.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  No browsers are currently connected. Open the URL above on another PC to see it appear here instantly.
                </div>
              ) : (
                <div className="peers-grid">
                  {webReceivers.map((wr) => (
                    <div
                      key={wr.id}
                      className="peer-card"
                      onClick={() => {
                        setSelectedPeerId(wr.id);
                        setActiveTab('cast');
                      }}
                    >
                      <div className="peer-icon web">
                        <Globe size={18} />
                      </div>
                      <div className="peer-meta">
                        <div className="peer-name">{wr.name}</div>
                        <div className="peer-sub">Client IP: {wr.hostname}</div>
                        <div className="peer-badges">
                          <span className="tag tag-green">Click to Select &amp; Cast</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'settings' && config && (
          <SettingsView
            config={config}
            displays={displays}
            onUpdateConfig={handleUpdateConfig}
            onRegeneratePin={handleRegeneratePin}
          />
        )}
      </main>
    </div>
  );
};
