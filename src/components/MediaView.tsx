import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Cast,
  Film,
  Globe,
  Laptop,
  ListMusic,
  Lock,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Save,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Subtitles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  DiscoveredPeer,
  MediaQueueItem,
  QualityPreset,
  SavedPlaylist,
  SelfInfo,
  StreamStats,
} from '../types/mycast';
import { formatDuration } from '../utils/mediaMetadata';

interface MediaViewProps {
  selfInfo: SelfInfo | null;
  peers: DiscoveredPeer[];
  selectedPeerId: string | null;
  onSelectPeer: (peerId: string) => void;
  quality: QualityPreset;
  onChangeQuality: (next: QualityPreset) => void;
  pinInput: string;
  onChangePinInput: (val: string) => void;
  castState: 'stopped' | 'connecting' | 'casting';
  castMode: 'screen' | 'media';
  audioMuted: boolean;
  stats: StreamStats | null;
  warning: string | null;
  error: string | null;
  onDismissWarning: () => void;
  onDismissError: () => void;
  onRefreshPeers: () => void;
  onAddManualPeer: (hostOrIp: string) => Promise<void>;
  onRemoveManualPeer: (peerId: string) => void;
  queue: MediaQueueItem[];
  activeIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  loopMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  activeSubtitleCue: string | null;
  savedPlaylists: SavedPlaylist[];
  onAddFiles: () => Promise<void>;
  onDropPaths: (filePaths: string[]) => Promise<void>;
  onSelectQueueItem: (index: number) => void;
  onMoveQueueItem: (index: number, direction: -1 | 1) => void;
  onRemoveQueueItem: (index: number) => void;
  onClearQueue: () => void;
  onAttachSubtitle: (index: number) => Promise<void>;
  onClearSubtitle: (index: number) => void;
  onTogglePlayPause: () => void;
  onSeek: (timeSec: number) => void;
  onSkipBy: (deltaSec: number) => void;
  onPrevTrack: () => void;
  onNextTrack: () => void;
  onChangePlaybackRate: (rate: number) => void;
  onCycleLoopMode: () => void;
  onToggleShuffle: () => void;
  onToggleAudioMuted: () => void;
  onStartMediaCast: () => void;
  onStopCast: () => void;
  onSavePlaylist: (name: string) => Promise<void>;
  onLoadPlaylist: (playlist: SavedPlaylist, mode: 'replace' | 'append') => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const MediaView: React.FC<MediaViewProps> = ({
  selfInfo,
  peers,
  selectedPeerId,
  onSelectPeer,
  quality,
  onChangeQuality,
  pinInput,
  onChangePinInput,
  castState,
  castMode,
  audioMuted,
  stats,
  warning,
  error,
  onDismissWarning,
  onDismissError,
  onRefreshPeers,
  onAddManualPeer,
  onRemoveManualPeer,
  queue,
  activeIndex,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  loopMode,
  shuffle,
  activeSubtitleCue,
  savedPlaylists,
  onAddFiles,
  onDropPaths,
  onSelectQueueItem,
  onMoveQueueItem,
  onRemoveQueueItem,
  onClearQueue,
  onAttachSubtitle,
  onClearSubtitle,
  onTogglePlayPause,
  onSeek,
  onSkipBy,
  onPrevTrack,
  onNextTrack,
  onChangePlaybackRate,
  onCycleLoopMode,
  onToggleShuffle,
  onToggleAudioMuted,
  onStartMediaCast,
  onStopCast,
  onSavePlaylist,
  onLoadPlaylist,
  onDeletePlaylist,
}) => {
  const [showAddIp, setShowAddIp] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [savingPlaylist, setSavingPlaylist] = useState(false);

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

  const currentItem = activeIndex >= 0 && activeIndex < queue.length ? queue[activeIndex] : null;
  const effectiveDuration =
    duration > 0 && Number.isFinite(duration) ? duration : currentItem?.duration || 0;
  const clampedTime = Math.min(currentTime, effectiveDuration || currentTime);

  const isCastingMedia = castState === 'casting' && castMode === 'media';
  const lockMediaSetup = castState === 'connecting' || isCastingMedia;

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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;

    const paths: string[] = [];
    for (const file of files) {
      try {
        const p = window.mycast.getPathForFile(file);
        if (p) paths.push(p);
      } catch {
        // Ignore entries without local path
      }
    }

    if (paths.length > 0) {
      await onDropPaths(paths);
    }
  };

  const handleSavePlaylistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = playlistName.trim();
    if (!trimmed || queue.length === 0) return;
    setSavingPlaylist(true);
    try {
      await onSavePlaylist(trimmed);
      setPlaylistName('');
    } finally {
      setSavingPlaylist(false);
    }
  };

  const loopLabel =
    loopMode === 'one' ? 'Loop One' : loopMode === 'all' ? 'Loop All' : 'Loop Off';

  return (
    <>
      <div
        className="scroll-view"
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) {
            setDragActive(false);
          }
        }}
        onDrop={handleDrop}
      >
        <div className="page-header">
          <div>
            <h1 className="page-title">Cast Local Media</h1>
            <p className="page-subtitle">
              Queue local video files and external subtitles (.srt / .vtt) and stream cleanly to any receiver while keeping this PC silent.
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

        {/* Receiver Selection & Quality */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-title-group">
              <span className="step-badge">1</span>
              <h2 className="section-title">Receiver &amp; Stream Quality</h2>
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
                placeholder="Enter receiver IP or IP:Port (e.g. 192.168.1.45)"
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
                  onClick={() => !lockMediaSetup && onSelectPeer(peer.id)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !lockMediaSetup) {
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
                        <span
                          className="tag tag-amber"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Lock size={10} /> PIN
                        </span>
                      )}
                    </div>
                  </div>
                  {peer.isManual && !lockMediaSetup && (
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

          <div className="quality-row">
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
                disabled={lockMediaSetup}
                onClick={() => onChangeQuality({ ...quality, includeAudio: !quality.includeAudio })}
              >
                {quality.includeAudio ? <Volume2 size={15} /> : <VolumeX size={15} />}
                <span>{quality.includeAudio ? 'Cast Audio On' : 'Video Only'}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Now Playing & Transport Deck (No Live Video Preview) */}
        <section className="section-card media-transport-card">
          <div className="section-header">
            <div className="section-title-group">
              <span className="step-badge">2</span>
              <h2 className="section-title">Now Playing &amp; Playback Controls</h2>
            </div>
            {currentItem && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm"
                  onClick={() => onAttachSubtitle(activeIndex)}
                  title="Attach .srt or .vtt subtitle file"
                >
                  <Subtitles size={14} />
                  <span>{currentItem.subtitleName ? 'Change Subtitles' : 'Attach Subtitles'}</span>
                </button>
                {currentItem.subtitleName && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onClearSubtitle(activeIndex)}
                    title="Remove subtitles"
                  >
                    <X size={14} />
                    <span>Clear Sub</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {currentItem ? (
            <div className="now-playing-layout">
              <div className="media-poster">
                {currentItem.thumbnailDataUrl ? (
                  <img src={currentItem.thumbnailDataUrl} alt={currentItem.name} />
                ) : (
                  <div className="media-poster-fallback">
                    <Film size={28} color="#94a3b8" />
                  </div>
                )}
              </div>

              <div className="now-playing-details">
                <div className="now-playing-title" title={currentItem.name}>
                  {currentItem.name}
                </div>
                <div className="now-playing-meta">
                  {currentItem.width > 0 && currentItem.height > 0 && (
                    <span className="tag tag-indigo">
                      {currentItem.width}×{currentItem.height}
                    </span>
                  )}
                  <span className="tag">
                    {formatDuration(effectiveDuration)}
                  </span>
                  {currentItem.subtitleName && (
                    <span className="tag tag-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Subtitles size={11} />
                      {currentItem.subtitleName}
                    </span>
                  )}
                  {isCastingMedia && (
                    <span className="tag tag-green">Streaming to Receiver</span>
                  )}
                </div>

                {currentItem.error && (
                  <div className="media-error-inline">{currentItem.error}</div>
                )}

                {activeSubtitleCue && (
                  <div className="subtitle-preview-line">
                    <Subtitles size={13} />
                    <span>{activeSubtitleCue}</span>
                  </div>
                )}

                <div className="timeline-row">
                  <span className="time-code">{formatDuration(clampedTime)}</span>
                  <input
                    type="range"
                    className="media-scrubber"
                    min={0}
                    max={effectiveDuration > 0 ? effectiveDuration : 1}
                    step={0.25}
                    value={effectiveDuration > 0 ? clampedTime : 0}
                    disabled={effectiveDuration <= 0}
                    onChange={(e) => onSeek(Number(e.target.value))}
                  />
                  <span className="time-code">{formatDuration(effectiveDuration)}</span>
                </div>

                <div className="transport-controls-row">
                  <div className="transport-buttons">
                    <button
                      className="btn btn-sm"
                      onClick={onPrevTrack}
                      disabled={queue.length === 0}
                      title="Previous track"
                    >
                      <SkipBack size={15} />
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => onSkipBy(-10)}
                      title="Rewind 10 seconds"
                    >
                      <RotateCcw size={15} />
                      <span>-10s</span>
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={onTogglePlayPause}
                      title={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                      <span>{isPlaying ? 'Pause' : 'Play'}</span>
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => onSkipBy(10)}
                      title="Forward 10 seconds"
                    >
                      <RotateCw size={15} />
                      <span>+10s</span>
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={onNextTrack}
                      disabled={queue.length === 0}
                      title="Next track"
                    >
                      <SkipForward size={15} />
                    </button>
                  </div>

                  <div className="transport-secondary">
                    <div className="pill-group" title="Playback speed">
                      {SPEED_OPTIONS.map((rate) => (
                        <button
                          key={rate}
                          className={`pill-option ${playbackRate === rate ? 'active' : ''}`}
                          onClick={() => onChangePlaybackRate(rate)}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>

                    <button
                      className={`btn btn-sm ${loopMode !== 'off' ? 'btn-primary' : ''}`}
                      onClick={onCycleLoopMode}
                      title="Cycle loop mode (Off / All / One)"
                    >
                      {loopMode === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
                      <span>{loopLabel}</span>
                    </button>

                    <button
                      className={`btn btn-sm ${shuffle ? 'btn-primary' : ''}`}
                      onClick={onToggleShuffle}
                      title="Toggle shuffle"
                    >
                      <Shuffle size={14} />
                      <span>Shuffle</span>
                    </button>

                    <button
                      className="btn btn-sm"
                      onClick={onToggleAudioMuted}
                      disabled={!quality.includeAudio}
                      title={audioMuted ? 'Unmute cast audio' : 'Mute cast audio'}
                    >
                      {audioMuted || !quality.includeAudio ? (
                        <VolumeX size={14} />
                      ) : (
                        <Volume2 size={14} />
                      )}
                      <span>{audioMuted ? 'Muted' : 'Audio'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-media-state">
              Add video files below or drag and drop them anywhere on this page to start casting.
            </div>
          )}
        </section>

        {/* Queue & Drag-and-Drop */}
        <section className={`section-card dropzone ${dragActive ? 'drag-active' : ''}`}>
          <div className="section-header">
            <div className="section-title-group">
              <span className="step-badge">3</span>
              <h2 className="section-title">Media Queue ({queue.length})</h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={onAddFiles}>
                <Upload size={14} />
                <span>Add Videos</span>
              </button>
              {currentItem && (
                <button className="btn btn-sm" onClick={() => onAttachSubtitle(activeIndex)}>
                  <Subtitles size={14} />
                  <span>Attach Subtitles (.srt/.vtt)</span>
                </button>
              )}
              {queue.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={onClearQueue}>
                  <Trash2 size={14} />
                  <span>Clear Queue</span>
                </button>
              )}
            </div>
          </div>

          <div className="drop-hint-strip">
            <Upload size={14} />
            <span>
              Drag &amp; drop video files (.mp4, .webm, .mkv, .mov, .m4v) to enqueue, or drop .srt / .vtt subtitles to attach to the active track.
            </span>
          </div>

          {queue.length > 0 && (
            <div className="queue-list">
              {queue.map((item, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <div
                    key={item.id}
                    className={`queue-item ${isActive ? 'active' : ''}`}
                    onClick={() => onSelectQueueItem(idx)}
                  >
                    <div className="queue-index">
                      {isActive && isPlaying ? (
                        <span className="status-dot" />
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>

                    <div className="queue-thumb">
                      {item.thumbnailDataUrl ? (
                        <img src={item.thumbnailDataUrl} alt="" />
                      ) : (
                        <Film size={16} color="#64748b" />
                      )}
                    </div>

                    <div className="queue-meta">
                      <div className="queue-title" title={item.name}>
                        {item.name}
                      </div>
                      <div className="queue-sub">
                        <span>{formatDuration(item.duration)}</span>
                        {item.width > 0 && item.height > 0 && (
                          <span> • {item.width}×{item.height}</span>
                        )}
                        {item.subtitleName && (
                          <span className="queue-sub-badge"> • CC: {item.subtitleName}</span>
                        )}
                        {item.error && (
                          <span style={{ color: '#fca5a5' }}> • {item.error}</span>
                        )}
                      </div>
                    </div>

                    <div
                      className="queue-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="btn btn-ghost btn-sm"
                        title={item.subtitleName ? 'Replace subtitles' : 'Attach subtitles'}
                        onClick={() => onAttachSubtitle(idx)}
                      >
                        <Subtitles size={14} />
                      </button>
                      {item.subtitleName && (
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Remove subtitles"
                          onClick={() => onClearSubtitle(idx)}
                        >
                          <X size={13} />
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Move up"
                        disabled={idx === 0}
                        onClick={() => onMoveQueueItem(idx, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Move down"
                        disabled={idx === queue.length - 1}
                        onClick={() => onMoveQueueItem(idx, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Remove from queue"
                        onClick={() => onRemoveQueueItem(idx)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Saved Playlists */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-title-group">
              <ListMusic size={18} color="#818cf8" />
              <h2 className="section-title">Saved Playlists ({savedPlaylists.length})</h2>
            </div>
          </div>

          <form
            onSubmit={handleSavePlaylistSubmit}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}
          >
            <input
              className="input"
              style={{ flex: 1, minWidth: '220px' }}
              placeholder="Playlist name (e.g. Movie Night)"
              value={playlistName}
              maxLength={60}
              onChange={(e) => setPlaylistName(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              type="submit"
              disabled={savingPlaylist || !playlistName.trim() || queue.length === 0}
            >
              <Save size={14} />
              <span>Save Current Queue</span>
            </button>
          </form>

          {savedPlaylists.length === 0 ? (
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
              No saved playlists yet. Build a queue above and save it for one-click reload across restarts.
            </div>
          ) : (
            <div className="saved-playlists-list">
              {savedPlaylists.map((pl) => (
                <div key={pl.id} className="saved-playlist-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600 }}>{pl.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {pl.items.length} {pl.items.length === 1 ? 'item' : 'items'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => onLoadPlaylist(pl, 'replace')}
                    >
                      Load
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => onLoadPlaylist(pl, 'append')}
                    >
                      Append
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Delete playlist"
                      onClick={() => onDeletePlaylist(pl.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Bottom Cast Dock */}
      <div className="cast-dock">
        <div className="cast-dock-summary">
          {isCastingMedia && stats ? (
            <div className="telemetry-pill">
              <span className="status-dot" />
              <span>
                {stats.width > 0 ? `${stats.width}×${stats.height}` : 'Streaming Media'} •{' '}
                {stats.fps}fps • {stats.bitrateMbps.toFixed(1)} Mbps • {stats.rttMs}ms RTT
                {stats.codec ? ` • ${stats.codec.replace('video/', '')}` : ''}
              </span>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
                {selectedPeer ? `Target: ${selectedPeer.name}` : 'Select a receiver device'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {currentItem
                  ? `Ready: ${currentItem.name}`
                  : 'Add one or more videos to the queue'}
              </div>
            </div>
          )}
        </div>

        <div className="cast-dock-actions">
          {!isCastingMedia && selectedPeer?.pinRequired && (
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

          {isCastingMedia ? (
            <>
              <button className="btn" onClick={onTogglePlayPause}>
                {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>
              <button className="btn" onClick={onToggleAudioMuted} disabled={!quality.includeAudio}>
                {audioMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                <span>{audioMuted ? 'Unmute' : 'Mute'}</span>
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
                queue.length === 0 ||
                (selectedPeer.pinRequired && pinInput.length < 4)
              }
              onClick={onStartMediaCast}
            >
              <Cast size={16} />
              <span>
                {castState === 'connecting'
                  ? 'Connecting...'
                  : castState === 'casting'
                    ? 'Switch to Media Cast'
                    : 'Cast Queue'}
              </span>
            </button>
          )}
        </div>
      </div>
    </>
  );
};
