import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Cast,
  Info,
  Lock,
  Maximize,
  Minimize,
  Monitor,
  PhoneOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DisplayInfo, SelfInfo, StreamStats } from '../types/mycast';

interface ReceiverViewProps {
  selfInfo: SelfInfo | null;
  stream: MediaStream | null;
  senderName: string;
  stats: StreamStats | null;
  displays: DisplayInfo[];
  targetDisplayId: number | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onMoveToDisplay: (displayId: number) => void;
  onDisconnect: () => void;
  onExitToCast: () => void;
}

export const ReceiverView: React.FC<ReceiverViewProps> = ({
  selfInfo,
  stream,
  senderName,
  stats,
  displays,
  targetDisplayId,
  isFullscreen,
  onToggleFullscreen,
  onMoveToDisplay,
  onDisconnect,
  onExitToCast,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hudTimerRef = useRef<number | null>(null);

  const [now, setNow] = useState(() => new Date());
  const [hudVisible, setHudVisible] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fillMode, setFillMode] = useState(false);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) {
      video.volume = volume;
      video.muted = muted;
      video.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  const wakeHud = () => {
    setHudVisible(true);
    if (hudTimerRef.current) {
      window.clearTimeout(hudTimerRef.current);
    }
    if (stream) {
      hudTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, 3000);
    }
  };

  useEffect(() => {
    wakeHud();
    return () => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    };
  }, [stream]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggleFullscreen]);

  const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateString = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      className={`receiver-root ${isFullscreen ? 'fullscreen' : ''} ${
        stream && !hudVisible ? 'hide-cursor' : ''
      }`}
      onMouseMove={wakeHud}
      onMouseDown={wakeHud}
    >
      {!stream ? (
        <div className="ambient-stage">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="brand-icon">
                <Cast size={20} />
              </div>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700 }}>MyCast Receiver</div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  Waiting for an incoming cast on your LAN
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button className="btn" onClick={onToggleFullscreen}>
                {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
                <span>{isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}</span>
              </button>
              {!isFullscreen && (
                <button className="btn btn-primary" onClick={onExitToCast}>
                  <ArrowLeft size={15} />
                  <span>Back to Cast</span>
                </button>
              )}
            </div>
          </div>

          <div style={{ margin: 'auto 0' }}>
            <div className="ambient-clock">{timeString}</div>
            <div className="ambient-date">{dateString}</div>

            {selfInfo && (
              <div className="ambient-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span className="status-dot" />
                  <span style={{ fontSize: '15px', fontWeight: 600 }}>{selfInfo.name}</span>
                  <span className="tag tag-indigo">
                    {selfInfo.ip}:{selfInfo.port}
                  </span>
                  {selfInfo.pinRequired && (
                    <span className="pin-pill">
                      <Lock size={12} />
                      <span>PIN: {selfInfo.pinCode}</span>
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  To cast without installing the app on another PC, open{' '}
                  <code style={{ color: '#a5b4fc' }}>{selfInfo.webReceiverUrl}</code> in any browser.
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12.5px',
              color: 'var(--text-muted)',
            }}
          >
            <span>Chromecast-style Ambient Mode</span>
            <span>Press F11 to toggle fullscreen</span>
          </div>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            className={`player-video ${fillMode ? 'fill' : ''}`}
            autoPlay
            playsInline
            onDoubleClick={onToggleFullscreen}
          />

          {showStats && stats && (
            <div className="stats-nerds">
              <div>Sender: {senderName}</div>
              <div>
                Resolution: {stats.width > 0 ? `${stats.width}×${stats.height}` : 'Negotiating'}
              </div>
              <div>Frame Rate: {stats.fps} fps</div>
              <div>Bitrate: {stats.bitrateMbps.toFixed(2)} Mbps</div>
              <div>Jitter: {stats.jitterMs} ms</div>
              <div>RTT: {stats.rttMs} ms</div>
              <div>Codec: {stats.codec || 'auto'}</div>
            </div>
          )}

          <div className={`receiver-hud ${hudVisible ? '' : 'hidden'}`}>
            <div className="live-indicator">
              <span className="live-dot" />
              <span>
                LIVE • {senderName}
                {stats && stats.width > 0
                  ? ` • ${stats.width}×${stats.height} ${stats.fps}fps • ${stats.bitrateMbps.toFixed(1)} Mbps`
                  : ''}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn btn-sm"
                onClick={() => setMuted((m) => !m)}
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                type="range"
                className="vol-slider"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  if (val > 0 && muted) setMuted(false);
                }}
              />
            </div>

            <button className="btn btn-sm" onClick={() => setFillMode((f) => !f)}>
              {fillMode ? 'Fit Screen' : 'Fill Screen'}
            </button>

            {displays.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Monitor size={14} color="#94a3b8" />
                <select
                  className="select"
                  style={{ padding: '5px 8px', fontSize: '12px' }}
                  value={targetDisplayId ?? displays[0]?.id ?? ''}
                  onChange={(e) => onMoveToDisplay(Number(e.target.value))}
                >
                  {displays.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              className={`btn btn-sm ${showStats ? 'btn-primary' : ''}`}
              onClick={() => setShowStats((s) => !s)}
              title="Stats for Nerds"
            >
              <Info size={14} />
              <span>Stats</span>
            </button>

            <button className="btn btn-sm" onClick={onToggleFullscreen}>
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
              <span>{isFullscreen ? 'Window' : 'Fullscreen'}</span>
            </button>

            <button className="btn btn-danger btn-sm" onClick={onDisconnect}>
              <PhoneOff size={14} />
              <span>Disconnect</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
