import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cast,
  Globe,
  Laptop,
  Lock,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  DesktopSourceInfo,
  DiscoveredPeer,
  QualityPreset,
  SelfInfo,
  StreamStats,
} from '../types/mycast';

interface SenderViewProps {
  selfInfo: SelfInfo | null;
  peers: DiscoveredPeer[];
  sources: DesktopSourceInfo[];
  selectedPeerId: string | null;
  onSelectPeer: (peerId: string) => void;
  selectedSourceId: string | null;
  onSelectSource: (sourceId: string) => void;
  quality: QualityPreset;
  onChangeQuality: (next: QualityPreset) => void;
  pinInput: string;
  onChangePinInput: (val: string) => void;
  castState: 'stopped' | 'connecting' | 'casting';
  videoPaused: boolean;
  audioMuted: boolean;
  stats: StreamStats | null;
  warning: string | null;
  error: string | null;
  onDismissWarning: () => void;
  onDismissError: () => void;
  onRefreshPeers: () => void;
  onRefreshSources: () => void;
  onAddManualPeer: (hostOrIp: string) => Promise<void>;
  onRemoveManualPeer: (peerId: string) => void;
  onStartCast: () => void;
  onStopCast: () => void;
  onSwitchSource: (sourceId: string) => void;
  onToggleVideoPaused: () => void;
  onToggleAudioMuted: () => void;
}

export const SenderView: React.FC<SenderViewProps> = ({
  selfInfo,
  peers,
  sources,
  selectedPeerId,
  onSelectPeer,
  selectedSourceId,
  onSelectSource,
  quality,
  onChangeQuality,
  pinInput,
  onChangePinInput,
  castState,
  videoPaused,
  audioMuted,
  stats,
  warning,
  error,
  onDismissWarning,
  onDismissError,
  onRefreshPeers,
  onRefreshSources,
  onAddManualPeer,
  onRemoveManualPeer,
  onStartCast,
  onStopCast,
  onSwitchSource,
  onToggleVideoPaused,
  onToggleAudioMuted,
}) => {
  const [sourceFilter, setSourceFilter] = useState<'all' | 'screen' | 'window'>('all');
  const [showAddIp, setShowAddIp] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [addingManual, setAddingManual] = useState(false);

  const allTargets = useMemo<DiscoveredPeer[]>(() => {
    const list: DiscoveredPeer[] = [...peers];
    if (selfInfo) {
      list.push({
        id: '__loopback__',
        name: `${selfInfo.name} (Loopback Test)`,
        hostname: selfInfo.hostname,
        ip: '127.0.0.1',
        port: selfInfo.port,
        pinRequired: selfInfo.pinRequired,
        status: 'idle',
        lastSeen: Date.now(),
        isLoopback: true,
      });
    }
    return list;
  }, [peers, selfInfo]);

  const selectedPeer = useMemo(
    () => allTargets.find((p) => p.id === selectedPeerId) || null,
    [allTargets, selectedPeerId]
  );

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );

  const filteredSources = useMemo(() => {
    if (sourceFilter === 'all') return sources;
    return sources.filter((s) => s.type === sourceFilter);
  }, [sources, sourceFilter]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualHost.trim()) return;
    setAddingManual(true);
    setManualError(null);
    try {
      await onAddManualPeer(manualHost.trim());
      setManualHost('');
      setShowAddIp(false);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Failed to reach receiver');
    } finally {
      setAddingManual(false);
    }
  };

  const isBusy = castState !== 'stopped';

  return (
    <>
      <div className="scroll-view">
        <div className="page-header">
          <div>
            <h1 className="page-title">Cast Your Screen</h1>
            <p className="page-subtitle">
              Mirror any monitor or app window with system audio to another PC or browser on your local network.
            </p>
          </div>
        </div>

        {error && (
          <div className="banner banner-error">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onDismissError}>
              <X size={15} />
            </button>
          </div>
        )}

        {warning && (
          <div className="banner banner-warn">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle size={17} />
              <span>{warning}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onDismissWarning}>
              <X size={15} />
            </button>
          </div>
        )}

        {/* Step 1: Select Receiver */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-title-group">
              <span className="step-badge">1</span>
              <h2 className="section-title">Select Receiver Device</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setShowAddIp((v) => !v);
                  setManualError(null);
                }}
              >
                <Plus size={14} />
                <span>Add by IP</span>
              </button>
              <button className="btn btn-sm" onClick={onRefreshPeers}>
                <RefreshCw size={14} />
                <span>Scan LAN</span>
              </button>
            </div>
          </div>

          {showAddIp && (
            <form
              onSubmit={handleManualSubmit}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                padding: '12px',
                borderRadius: '10px',
                background: 'rgba(7, 10, 18, 0.55)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <input
                className="input"
                style={{ flex: 1, minWidth: '220px' }}
                placeholder="Enter receiver IP or IP:Port (e.g. 192.168.1.45 or 192.168.1.45:48900)"
                value={manualHost}
                onChange={(e) => setManualHost(e.target.value)}
                disabled={addingManual}
              />
              <button className="btn btn-primary btn-sm" type="submit" disabled={addingManual}>
                {addingManual ? 'Connecting...' : 'Add Receiver'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setShowAddIp(false)}
              >
                Cancel
              </button>
              {manualError && (
                <div style={{ width: '100%', color: '#fca5a5', fontSize: '12px' }}>
                  {manualError}
                </div>
              )}
            </form>
          )}

          <div className="peers-grid">
            {allTargets.map((peer) => {
              const selected = peer.id === selectedPeerId;
              return (
                <div
                  key={peer.id}
                  role="button"
                  tabIndex={0}
                  className={`peer-card ${selected ? 'selected' : ''}`}
                  onClick={() => !isBusy && onSelectPeer(peer.id)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isBusy) {
                      e.preventDefault();
                      onSelectPeer(peer.id);
                    }
                  }}
                >
                  <div
                    className={`peer-icon ${
                      peer.isWebReceiver ? 'web' : peer.isLoopback ? 'loopback' : ''
                    }`}
                  >
                    {peer.isWebReceiver ? (
                      <Globe size={19} />
                    ) : peer.isLoopback ? (
                      <Monitor size={19} />
                    ) : (
                      <Laptop size={19} />
                    )}
                  </div>
                  <div className="peer-meta">
                    <div className="peer-name">{peer.name}</div>
                    <div className="peer-sub">
                      {peer.isWebReceiver
                        ? `Web Fallback • ${peer.hostname}`
                        : `${peer.ip}:${peer.port}`}
                    </div>
                    <div className="peer-badges">
                      <span
                        className={`tag ${
                          peer.isLoopback
                            ? 'tag-amber'
                            : peer.status === 'idle'
                              ? 'tag-green'
                              : 'tag-indigo'
                        }`}
                      >
                        {peer.isLoopback
                          ? 'Self-Test'
                          : peer.status === 'idle'
                            ? 'Ready'
                            : peer.status === 'receiving'
                              ? 'In Use'
                              : 'Casting'}
                      </span>
                      {peer.pinRequired && (
                        <span className="tag tag-amber" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Lock size={10} /> PIN
                        </span>
                      )}
                    </div>
                  </div>
                  {peer.isManual && !isBusy && (
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Remove manual receiver"
                      style={{ padding: '4px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveManualPeer(peer.id);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {peers.length === 0 && (
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Searching your local network for other MyCast PCs… Run MyCast on another PC or open{' '}
              <code style={{ color: '#a5b4fc' }}>{selfInfo?.webReceiverUrl}</code> in any browser.
            </div>
          )}
        </section>

        {/* Step 2: Select Screen or App Window */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-title-group">
              <span className="step-badge">2</span>
              <h2 className="section-title">
                {castState === 'casting'
                  ? 'Select Screen or Window (Click to Switch Live)'
                  : 'Select Screen or App Window'}
              </h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div className="tabs-row">
                <button
                  className={`tab-btn ${sourceFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setSourceFilter('all')}
                >
                  All ({sources.length})
                </button>
                <button
                  className={`tab-btn ${sourceFilter === 'screen' ? 'active' : ''}`}
                  onClick={() => setSourceFilter('screen')}
                >
                  Screens ({sources.filter((s) => s.type === 'screen').length})
                </button>
                <button
                  className={`tab-btn ${sourceFilter === 'window' ? 'active' : ''}`}
                  onClick={() => setSourceFilter('window')}
                >
                  App Windows ({sources.filter((s) => s.type === 'window').length})
                </button>
              </div>
              <button className="btn btn-sm" onClick={onRefreshSources}>
                <RefreshCw size={14} />
                <span>Refresh Previews</span>
              </button>
            </div>
          </div>

          <div className="sources-grid">
            {filteredSources.map((src) => {
              const selected = src.id === selectedSourceId;
              return (
                <button
                  key={src.id}
                  className={`source-card ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectSource(src.id);
                    if (castState === 'casting' && src.id !== selectedSourceId) {
                      onSwitchSource(src.id);
                    }
                  }}
                >
                  <div className="source-thumb-wrap">
                    <img
                      className="source-thumb"
                      src={src.thumbnailDataUrl}
                      alt={src.name}
                      draggable={false}
                    />
                    <span className="source-type-badge">
                      {src.type === 'screen' ? 'DISPLAY' : 'WINDOW'}
                    </span>
                  </div>
                  <div className="source-info">
                    {src.appIconDataUrl && (
                      <img className="source-app-icon" src={src.appIconDataUrl} alt="" />
                    )}
                    <span className="source-title" title={src.name}>
                      {src.name}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Step 3: Stream Quality & Audio */}
        <section className="section-card">
          <div className="section-title-group">
            <span className="step-badge">3</span>
            <h2 className="section-title">Stream Quality &amp; Audio</h2>
          </div>

          <div className="quality-row">
            <div className="quality-group">
              <span className="quality-label">Resolution</span>
              <div className="pill-group">
                {(['native', '1080p', '720p'] as const).map((res) => (
                  <button
                    key={res}
                    className={`pill-option ${quality.resolution === res ? 'active' : ''}`}
                    disabled={isBusy}
                    onClick={() => onChangeQuality({ ...quality, resolution: res })}
                  >
                    {res === 'native' ? 'Native' : res}
                  </button>
                ))}
              </div>
            </div>

            <div className="quality-group">
              <span className="quality-label">Frame Rate</span>
              <div className="pill-group">
                {([60, 30] as const).map((fps) => (
                  <button
                    key={fps}
                    className={`pill-option ${quality.fps === fps ? 'active' : ''}`}
                    disabled={isBusy}
                    onClick={() => onChangeQuality({ ...quality, fps })}
                  >
                    {fps} FPS
                  </button>
                ))}
              </div>
            </div>

            <div className="quality-group">
              <span className="quality-label">Target Bitrate</span>
              <div className="pill-group">
                {([3, 8, 15, 30] as const).map((mbps) => (
                  <button
                    key={mbps}
                    className={`pill-option ${quality.bitrateMbps === mbps ? 'active' : ''}`}
                    onClick={() => onChangeQuality({ ...quality, bitrateMbps: mbps })}
                  >
                    {mbps} Mbps
                  </button>
                ))}
              </div>
            </div>

            <div className="quality-group">
              <span className="quality-label">Audio</span>
              <button
                className={`btn btn-sm ${quality.includeAudio ? 'btn-primary' : ''}`}
                disabled={isBusy}
                onClick={() => onChangeQuality({ ...quality, includeAudio: !quality.includeAudio })}
              >
                {quality.includeAudio ? <Volume2 size={15} /> : <VolumeX size={15} />}
                <span>{quality.includeAudio ? 'System Audio On' : 'Video Only'}</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Cast Dock */}
      <div className="cast-dock">
        <div className="cast-dock-summary">
          {castState === 'casting' && stats ? (
            <div className="telemetry-pill">
              <span className="status-dot" />
              <span>
                {stats.width > 0 ? `${stats.width}×${stats.height}` : 'Streaming'} • {stats.fps}fps •{' '}
                {stats.bitrateMbps.toFixed(1)} Mbps • {stats.rttMs}ms RTT
                {stats.codec ? ` • ${stats.codec.replace('video/', '')}` : ''}
                {stats.qualityLimitationReason && stats.qualityLimitationReason !== 'none'
                  ? ` (${stats.qualityLimitationReason} limit)`
                  : ''}
              </span>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
                {selectedPeer ? `Target: ${selectedPeer.name}` : 'Select a receiver device'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {selectedSource ? `Source: ${selectedSource.name}` : 'Select a screen or window'}
              </div>
            </div>
          )}
        </div>

        <div className="cast-dock-actions">
          {castState === 'stopped' && selectedPeer?.pinRequired && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lock size={14} color="#fcd34d" />
              <input
                className="input"
                style={{ width: '110px', textAlign: 'center', letterSpacing: '0.15em' }}
                placeholder="4-digit PIN"
                maxLength={4}
                value={pinInput}
                onChange={(e) => onChangePinInput(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          )}

          {castState === 'casting' ? (
            <>
              <button className="btn" onClick={onToggleVideoPaused}>
                {videoPaused ? <Play size={15} /> : <Pause size={15} />}
                <span>{videoPaused ? 'Resume Video' : 'Pause Video'}</span>
              </button>
              <button className="btn" onClick={onToggleAudioMuted}>
                {audioMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                <span>{audioMuted ? 'Unmute Audio' : 'Mute Audio'}</span>
              </button>
              <button className="btn btn-danger" onClick={onStopCast}>
                <Square size={15} />
                <span>Stop Casting</span>
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              disabled={
                castState === 'connecting' ||
                !selectedPeer ||
                !selectedSource ||
                (selectedPeer.pinRequired && pinInput.length < 4)
              }
              onClick={onStartCast}
            >
              <Cast size={16} />
              <span>{castState === 'connecting' ? 'Connecting...' : 'Start Casting'}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
};
