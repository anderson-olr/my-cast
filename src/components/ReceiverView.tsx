import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Cast,
  CircleDot,
  FolderOpen,
  Info,
  Lock,
  Maximize,
  Minimize,
  Monitor,
  PhoneOff,
  Square,
  Subtitles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { DisplayInfo, SavedFileResult, SelfInfo, StreamStats } from '../types/mycast';
import { captureVideoScreenshot, ReceiverRecorder } from '../services/receiverRecorder';
import { formatDuration } from '../utils/mediaMetadata';

interface ReceiverViewProps {
  selfInfo: SelfInfo | null;
  stream: MediaStream | null;
  senderName: string;
  stats: StreamStats | null;
  subtitleText?: string | null;
  displays: DisplayInfo[];
  targetDisplayId: number | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onMoveToDisplay: (displayId: number) => void;
  onDisconnect: () => void;
  onExitToCast: () => void;
}

interface SaveToastState {
  fileName: string;
  filePath: string;
  error?: boolean;
}

export const ReceiverView: React.FC<ReceiverViewProps> = ({
  selfInfo,
  stream,
  senderName,
  stats,
  subtitleText = null,
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
  const recorderRef = useRef<ReceiverRecorder | null>(null);
  const recTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const [now, setNow] = useState(() => new Date());
  const [hudVisible, setHudVisible] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fillMode, setFillMode] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [hasReceivedSubtitles, setHasReceivedSubtitles] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [saveToast, setSaveToast] = useState<SaveToastState | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showToast = useCallback((toast: SaveToastState) => {
    if (!mountedRef.current) return;
    setSaveToast(toast);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        setSaveToast(null);
      }
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (subtitleText) {
      setHasReceivedSubtitles(true);
    }
  }, [subtitleText]);

  useEffect(() => {
    if (!stream) {
      setHasReceivedSubtitles(false);
    }
  }, [stream]);

  const stopRecordingInternal = useCallback(async () => {
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (!recorder || !recorder.isRecording()) {
      if (mountedRef.current) {
        setIsRecording(false);
        setRecordingSeconds(0);
      }
      return;
    }
    recorderRef.current = null;
    try {
      const saved: SavedFileResult | null = await recorder.stop();
      if (mountedRef.current) {
        setIsRecording(false);
        setRecordingSeconds(0);
      }
      if (saved) {
        showToast({ fileName: saved.fileName, filePath: saved.filePath });
      }
    } catch (err) {
      if (mountedRef.current) {
        setIsRecording(false);
        setRecordingSeconds(0);
      }
      showToast({
        fileName: err instanceof Error ? err.message : 'Failed to save recording',
        filePath: '',
        error: true,
      });
    }
  }, [showToast]);

  // Auto-stop and save any active recording when stream ends or component unmounts
  useEffect(() => {
    if (!stream) {
      stopRecordingInternal();
    }
    return () => {
      if (recorderRef.current?.isRecording()) {
        recorderRef.current.stop().catch(() => {});
        recorderRef.current = null;
      }
      if (recTimerRef.current) {
        window.clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
    };
  }, [stream, stopRecordingInternal]);

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

  const handleScreenshot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !stream) return;
    try {
      const saved = await captureVideoScreenshot(video, senderName);
      showToast({ fileName: saved.fileName, filePath: saved.filePath });
    } catch (err) {
      showToast({
        fileName: err instanceof Error ? err.message : 'Screenshot failed',
        filePath: '',
        error: true,
      });
    }
  }, [stream, senderName, showToast]);

  const handleToggleRecording = useCallback(async () => {
    if (!stream) return;
    if (isRecording) {
      await stopRecordingInternal();
      return;
    }

    const recorder = new ReceiverRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start(stream, senderName, (saved) => {
        if (recTimerRef.current) {
          window.clearInterval(recTimerRef.current);
          recTimerRef.current = null;
        }
        recorderRef.current = null;
        if (mountedRef.current) {
          setIsRecording(false);
          setRecordingSeconds(0);
          showToast({ fileName: saved.fileName, filePath: saved.filePath });
        }
      });

      if (mountedRef.current) {
        setIsRecording(true);
        setRecordingSeconds(0);
      }
      recTimerRef.current = window.setInterval(() => {
        if (mountedRef.current) {
          setRecordingSeconds((s) => s + 1);
        }
      }, 1000);
    } catch (err) {
      recorderRef.current = null;
      showToast({
        fileName: err instanceof Error ? err.message : 'Failed to start recording',
        filePath: '',
        error: true,
      });
    }
  }, [stream, isRecording, senderName, stopRecordingInternal, showToast]);

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

          {isRecording && (
            <div className="rec-badge">
              <span className="rec-dot" />
              <span>REC {formatDuration(recordingSeconds)}</span>
            </div>
          )}

          {subtitlesEnabled && subtitleText && (
            <div className="subtitle-overlay">{subtitleText}</div>
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

            {hasReceivedSubtitles && (
              <button
                className={`btn btn-sm ${subtitlesEnabled ? 'btn-primary' : ''}`}
                onClick={() => setSubtitlesEnabled((s) => !s)}
                title={subtitlesEnabled ? 'Hide Subtitles' : 'Show Subtitles'}
              >
                <Subtitles size={14} />
                <span>{subtitlesEnabled ? 'CC On' : 'CC Off'}</span>
              </button>
            )}

            <button
              className="btn btn-sm"
              onClick={handleScreenshot}
              title="Save PNG Screenshot"
            >
              <Camera size={14} />
              <span>Screenshot</span>
            </button>

            <button
              className={`btn btn-sm ${isRecording ? 'btn-danger' : ''}`}
              onClick={handleToggleRecording}
              title={isRecording ? 'Stop Recording' : 'Start Recording (.webm)'}
            >
              {isRecording ? <Square size={13} /> : <CircleDot size={14} color="#f87171" />}
              <span>{isRecording ? `Stop (${formatDuration(recordingSeconds)})` : 'Record'}</span>
            </button>

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

      {saveToast && (
        <div className={`save-toast ${saveToast.error ? 'error' : ''}`}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '12.5px', fontWeight: 600 }}>
              {saveToast.error ? saveToast.fileName : `Saved ${saveToast.fileName}`}
            </div>
          </div>
          {!saveToast.error && saveToast.filePath && (
            <button
              className="btn btn-sm"
              onClick={() => window.mycast.openFolder(saveToast.filePath).catch(() => {})}
            >
              <FolderOpen size={13} />
              <span>Open Folder</span>
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px' }}
            onClick={() => setSaveToast(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
