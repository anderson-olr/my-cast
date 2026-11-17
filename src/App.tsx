import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Globe,
  Laptop,
  Pause,
  Play,
  RefreshCw,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Sidebar, NavTab } from './components/Sidebar';
import { SenderView } from './components/SenderView';
import { MediaView } from './components/MediaView';
import { ReceiverView } from './components/ReceiverView';
import { SettingsView } from './components/SettingsView';
import { WebRtcSenderController } from './services/webrtcSender';
import { WebRtcReceiverController } from './services/webrtcReceiver';
import {
  AppConfig,
  DesktopSourceInfo,
  DiscoveredPeer,
  DisplayInfo,
  MediaQueueItem,
  QualityPreset,
  SavedPlaylist,
  SelfInfo,
  StreamStats,
} from './types/mycast';
import { probeMediaUrl } from './utils/mediaMetadata';
import { findActiveSubtitleCue, parseSubtitles, SubtitleCue } from './utils/subtitleParser';

const DEFAULT_QUALITY: QualityPreset = {
  resolution: '1080p',
  fps: 60,
  bitrateMbps: 8,
  includeAudio: true,
};

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.mov',
  '.m4v',
  '.avi',
  '.ogv',
]);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt']);

function getFileExtension(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  return idx >= 0 ? filePath.slice(idx).toLowerCase() : '';
}

function getFileBaseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function resolveTargetPeer(
  selfInfo: SelfInfo | null,
  peers: DiscoveredPeer[],
  selectedPeerId: string | null
): DiscoveredPeer | undefined {
  if (!selfInfo) return undefined;
  if (selectedPeerId === '__loopback__') {
    return {
      id: '__loopback__',
      name: `${selfInfo.name} (Loopback Test)`,
      hostname: selfInfo.hostname,
      ip: '127.0.0.1',
      port: selfInfo.port,
      pinRequired: selfInfo.pinRequired,
      status: 'idle',
      lastSeen: Date.now(),
      isLoopback: true,
    };
  }
  return peers.find((p) => p.id === selectedPeerId);
}

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
  const [castMode, setCastMode] = useState<'screen' | 'media'>('screen');
  const [videoPaused, setVideoPaused] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [senderStats, setSenderStats] = useState<StreamStats | null>(null);
  const [senderWarning, setSenderWarning] = useState<string | null>(null);
  const [senderError, setSenderError] = useState<string | null>(null);

  // Cast Media state
  const [mediaQueue, setMediaQueue] = useState<MediaQueueItem[]>([]);
  const [activeMediaIndex, setActiveMediaIndex] = useState<number>(-1);
  const [mediaIsPlaying, setMediaIsPlaying] = useState(false);
  const [mediaCurrentTime, setMediaCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [mediaPlaybackRate, setMediaPlaybackRate] = useState(1);
  const [mediaLoopMode, setMediaLoopMode] = useState<'off' | 'all' | 'one'>('off');
  const [mediaShuffle, setMediaShuffle] = useState(false);
  const [activeSubtitleCue, setActiveSubtitleCue] = useState<string | null>(null);
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>([]);

  // Receiver state
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [receiverSenderName, setReceiverSenderName] = useState('');
  const [receiverStats, setReceiverStats] = useState<StreamStats | null>(null);
  const [receiverSubtitleText, setReceiverSubtitleText] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const configRef = useRef<AppConfig | null>(null);
  const selfInfoRef = useRef<SelfInfo | null>(null);
  const activeTabRef = useRef<NavTab>('cast');
  const tabBeforeCastRef = useRef<NavTab>('cast');
  const enteredFullscreenForCastRef = useRef(false);
  const castStateRef = useRef<'stopped' | 'connecting' | 'casting'>('stopped');
  const castModeRef = useRef<'screen' | 'media'>('screen');
  const mediaQueueRef = useRef<MediaQueueItem[]>([]);
  const activeMediaIndexRef = useRef<number>(-1);
  const mediaLoopModeRef = useRef<'off' | 'all' | 'one'>('off');
  const mediaShuffleRef = useRef(false);
  const mediaPlaybackRateRef = useRef(1);
  const parsedCuesRef = useRef<SubtitleCue[]>([]);
  const lastSentCueRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);

  const mediaVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const activeMediaVideoTrackRef = useRef<MediaStreamTrack | null>(null);

  const activeMediaItem = useMemo(
    () =>
      activeMediaIndex >= 0 && activeMediaIndex < mediaQueue.length
        ? mediaQueue[activeMediaIndex]
        : null,
    [mediaQueue, activeMediaIndex]
  );

  const parsedSubtitleCues = useMemo(
    () => (activeMediaItem?.subtitleContent ? parseSubtitles(activeMediaItem.subtitleContent) : []),
    [activeMediaItem?.subtitleContent]
  );

  configRef.current = config;
  selfInfoRef.current = selfInfo;
  activeTabRef.current = activeTab;
  castStateRef.current = castState;
  castModeRef.current = castMode;
  mediaQueueRef.current = mediaQueue;
  activeMediaIndexRef.current = activeMediaIndex;
  mediaLoopModeRef.current = mediaLoopMode;
  mediaShuffleRef.current = mediaShuffle;
  mediaPlaybackRateRef.current = mediaPlaybackRate;
  parsedCuesRef.current = parsedSubtitleCues;

  const senderRef = useRef<WebRtcSenderController | null>(null);
  const receiverRef = useRef<WebRtcReceiverController | null>(null);

  const syncSubtitleForTime = useCallback((timeSec: number) => {
    const cue = findActiveSubtitleCue(parsedCuesRef.current, timeSec);
    setActiveSubtitleCue(cue);
    if (cue !== lastSentCueRef.current) {
      lastSentCueRef.current = cue;
      if (castStateRef.current === 'casting' && castModeRef.current === 'media') {
        senderRef.current?.sendSubtitleCue(cue);
      }
    }
  }, []);

  const ensureAudioGraph = useCallback(async () => {
    const video = mediaVideoRef.current;
    if (!video) throw new Error('Media playback element not mounted');
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(video);
      const dest = ctx.createMediaStreamDestination();
      // Route ONLY to MediaStreamAudioDestinationNode so sender speakers stay silent
      source.connect(dest);
      audioCtxRef.current = ctx;
      mediaSourceNodeRef.current = source;
      audioDestRef.current = dest;
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioDestRef.current!;
  }, []);

  const captureVideoTrackFromElement = useCallback(
    (video: HTMLVideoElement): MediaStreamTrack | null => {
      const captured = video.captureStream
        ? video.captureStream()
        : video.mozCaptureStream
          ? video.mozCaptureStream()
          : null;
      if (!captured) return null;
      return captured.getVideoTracks()[0] || null;
    },
    []
  );

  const loadMediaItem = useCallback(
    async (item: MediaQueueItem, shouldPlay: boolean): Promise<MediaStreamTrack | null> => {
      const video = mediaVideoRef.current;
      if (!video) throw new Error('Media playback element unavailable');

      const seq = ++loadSeqRef.current;

      await new Promise<void>((resolve, reject) => {
        const cleanupListeners = () => {
          video.onloadeddata = null;
          video.onerror = null;
        };

        video.onloadeddata = () => {
          cleanupListeners();
          resolve();
        };

        video.onerror = () => {
          cleanupListeners();
          reject(new Error(`Failed to decode "${item.name}". Unsupported codec or unreadable file.`));
        };

        video.pause();
        video.src = item.mediaUrl;
        video.currentTime = 0;
        video.playbackRate = mediaPlaybackRateRef.current;
        video.load();
      });

      if (seq !== loadSeqRef.current) return null;

      const dur = Number.isFinite(video.duration) ? video.duration : item.duration || 0;
      setMediaDuration(dur);
      setMediaCurrentTime(0);

      if (shouldPlay) {
        await ensureAudioGraph();
        await video.play();
      }

      if (seq !== loadSeqRef.current) return null;

      const newVideoTrack = captureVideoTrackFromElement(video);
      if (
        castStateRef.current === 'casting' &&
        castModeRef.current === 'media' &&
        senderRef.current
      ) {
        const prevTrack = activeMediaVideoTrackRef.current;
        await senderRef.current.replaceMediaVideoTrack(newVideoTrack);
        if (prevTrack && prevTrack !== newVideoTrack) {
          try {
            prevTrack.stop();
          } catch {
            // ignore
          }
        }
        activeMediaVideoTrackRef.current = newVideoTrack;
      }

      syncSubtitleForTime(video.currentTime || 0);
      return newVideoTrack;
    },
    [captureVideoTrackFromElement, ensureAudioGraph, syncSubtitleForTime]
  );

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
          if (castModeRef.current === 'media' && mediaVideoRef.current) {
            const cue = findActiveSubtitleCue(
              parsedCuesRef.current,
              mediaVideoRef.current.currentTime || 0
            );
            lastSentCueRef.current = cue;
            senderRef.current?.sendSubtitleCue(cue);
          }
        } else if (nextState === 'stopped') {
          setSenderStats(null);
          setVideoPaused(false);
          setAudioMuted(false);
          if (castModeRef.current === 'media') {
            if (mediaVideoRef.current && !mediaVideoRef.current.paused) {
              mediaVideoRef.current.pause();
            }
            setMediaIsPlaying(false);
            lastSentCueRef.current = null;
            if (activeMediaVideoTrackRef.current) {
              try {
                activeMediaVideoTrackRef.current.stop();
              } catch {
                // ignore
              }
              activeMediaVideoTrackRef.current = null;
            }
          }
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
        setReceiverSubtitleText(null);
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
      onSubtitleCue: (text) => {
        setReceiverSubtitleText(text);
      },
      onCastEnded: () => {
        setRemoteStream(null);
        setReceiverStats(null);
        setReceiverSenderName('');
        setReceiverSubtitleText(null);

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
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const [info, cfg, initialPeers, full, playlists] = await Promise.all([
        window.mycast.getSelfInfo(),
        window.mycast.getConfig(),
        window.mycast.getPeers(),
        window.mycast.isFullscreen(),
        window.mycast.getPlaylists().catch(() => [] as SavedPlaylist[]),
      ]);
      if (!mounted) return;
      setSelfInfo(info);
      setConfig(cfg);
      setQuality(cfg.defaultQuality || DEFAULT_QUALITY);
      setPeers(initialPeers);
      setIsFullscreen(full);
      setSavedPlaylists(playlists);

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

  const selectAndPlayIndex = useCallback(
    async (index: number, shouldPlay: boolean) => {
      const queue = mediaQueueRef.current;
      if (index < 0 || index >= queue.length) return;
      const item = queue[index];
      setActiveMediaIndex(index);
      setSenderError(null);
      try {
        await loadMediaItem(item, shouldPlay);
        setMediaQueue((prev) =>
          prev.map((q) => (q.id === item.id && q.error ? { ...q, error: undefined } : q))
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : `Failed to load ${item.name}`;
        setMediaQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, error: msg } : q))
        );
        setSenderError(msg);
        setMediaIsPlaying(false);
      }
    },
    [loadMediaItem]
  );

  const computeNextIndex = useCallback((currentIndex: number, queueLength: number): number => {
    if (queueLength === 0) return -1;
    if (mediaShuffleRef.current && queueLength > 1) {
      let next = currentIndex;
      while (next === currentIndex) {
        next = Math.floor(Math.random() * queueLength);
      }
      return next;
    }
    if (currentIndex + 1 < queueLength) {
      return currentIndex + 1;
    }
    if (mediaLoopModeRef.current === 'all') {
      return 0;
    }
    return -1;
  }, []);

  // Re-evaluate active subtitle cue whenever the active item's cues change
  useEffect(() => {
    const video = mediaVideoRef.current;
    syncSubtitleForTime(video ? video.currentTime : 0);
  }, [parsedSubtitleCues, syncSubtitleForTime]);

  // Attach listeners to the persistent hidden <video> media player
  useEffect(() => {
    const video = mediaVideoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setMediaCurrentTime(video.currentTime || 0);
      syncSubtitleForTime(video.currentTime || 0);
    };

    const onDurationChange = () => {
      if (Number.isFinite(video.duration)) {
        setMediaDuration(video.duration);
      }
    };

    const onPlay = () => setMediaIsPlaying(true);
    const onPause = () => setMediaIsPlaying(false);

    const onEnded = () => {
      setMediaIsPlaying(false);
      if (mediaLoopModeRef.current === 'one') {
        video.currentTime = 0;
        video.play().catch(() => {});
        return;
      }
      const nextIdx = computeNextIndex(
        activeMediaIndexRef.current,
        mediaQueueRef.current.length
      );
      if (nextIdx >= 0) {
        selectAndPlayIndex(nextIdx, true);
      } else {
        lastSentCueRef.current = null;
        setActiveSubtitleCue(null);
        if (castStateRef.current === 'casting' && castModeRef.current === 'media') {
          senderRef.current?.sendSubtitleCue(null);
        }
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('loadedmetadata', onDurationChange);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onDurationChange);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [computeNextIndex, selectAndPlayIndex, syncSubtitleForTime]);

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
    const target = resolveTargetPeer(selfInfo, peers, selectedPeerId);
    if (!target) return;

    setSenderError(null);
    setSenderWarning(null);

    if (castStateRef.current === 'casting') {
      await senderRef.current.stopCast(true, 'Stopped by sender');
    }

    if (mediaVideoRef.current && !mediaVideoRef.current.paused) {
      mediaVideoRef.current.pause();
    }
    lastSentCueRef.current = null;
    setActiveSubtitleCue(null);
    castModeRef.current = 'screen';
    setCastMode('screen');

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

  const handleStartMediaCast = useCallback(async () => {
    if (!selfInfo || !senderRef.current) return;
    const queue = mediaQueueRef.current;
    if (queue.length === 0) return;

    const target = resolveTargetPeer(selfInfo, peers, selectedPeerId);
    if (!target) return;

    const targetIndex =
      activeMediaIndexRef.current >= 0 && activeMediaIndexRef.current < queue.length
        ? activeMediaIndexRef.current
        : 0;
    const item = queue[targetIndex];
    setActiveMediaIndex(targetIndex);
    setSenderError(null);
    setSenderWarning(null);

    const video = mediaVideoRef.current;
    if (!video) return;

    try {
      if (castStateRef.current === 'casting') {
        await senderRef.current.stopCast(true, 'Stopped by sender');
      }

      const dest = await ensureAudioGraph();
      let videoTrack: MediaStreamTrack | null = null;

      if (video.src === item.mediaUrl && video.readyState >= 2) {
        video.playbackRate = mediaPlaybackRateRef.current;
        await video.play();
        videoTrack = captureVideoTrackFromElement(video);
      } else {
        videoTrack = await loadMediaItem(item, true);
      }

      if (!videoTrack) {
        throw new Error('Failed to capture video stream from media player');
      }

      if (activeMediaVideoTrackRef.current && activeMediaVideoTrackRef.current !== videoTrack) {
        try {
          activeMediaVideoTrackRef.current.stop();
        } catch {
          // ignore
        }
      }
      activeMediaVideoTrackRef.current = videoTrack;

      const stream = new MediaStream([videoTrack]);
      if (quality.includeAudio) {
        const audioTrack = dest.stream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = true;
          stream.addTrack(audioTrack);
        }
      }

      castModeRef.current = 'media';
      setCastMode('media');
      await senderRef.current.startMediaCast({
        target,
        stream,
        quality,
        selfId: selfInfo.id,
        selfName: selfInfo.name,
        selfPort: selfInfo.port,
        pin: target.pinRequired ? pinInput : undefined,
      });
    } catch (err) {
      if (!video.paused) {
        video.pause();
      }
      if (err instanceof Error) {
        setSenderError(err.message);
      }
    }
  }, [
    selfInfo,
    peers,
    selectedPeerId,
    quality,
    pinInput,
    ensureAudioGraph,
    captureVideoTrackFromElement,
    loadMediaItem,
  ]);

  const enqueueVideoFiles = useCallback(
    async (entries: Array<{ path: string; name?: string; size?: number }>) => {
      if (entries.length === 0) return;

      const created: MediaQueueItem[] = [];
      for (const entry of entries) {
        try {
          const mediaUrl = await window.mycast.registerMediaFile(entry.path);
          const meta = await probeMediaUrl(mediaUrl);
          created.push({
            id: crypto.randomUUID(),
            path: entry.path,
            name: entry.name || getFileBaseName(entry.path),
            size: entry.size || 0,
            mediaUrl,
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
            thumbnailDataUrl: meta.thumbnailDataUrl,
          });
        } catch (err) {
          created.push({
            id: crypto.randomUUID(),
            path: entry.path,
            name: entry.name || getFileBaseName(entry.path),
            size: entry.size || 0,
            mediaUrl: '',
            duration: 0,
            width: 0,
            height: 0,
            thumbnailDataUrl: null,
            error: err instanceof Error ? err.message : 'Failed to register media file',
          });
        }
      }

      const wasEmpty = mediaQueueRef.current.length === 0 || activeMediaIndexRef.current === -1;
      setMediaQueue((prev) => [...prev, ...created]);
      if (wasEmpty && created.length > 0 && created[0].mediaUrl) {
        setActiveMediaIndex(mediaQueueRef.current.length);
        loadMediaItem(created[0], false).catch(() => {});
      }
    },
    [loadMediaItem]
  );

  const handleAddMediaFiles = useCallback(async () => {
    const picked = await window.mycast.pickMediaFiles();
    if (picked.length > 0) {
      await enqueueVideoFiles(picked);
    }
  }, [enqueueVideoFiles]);

  const attachSubtitleFromPath = useCallback(async (index: number, filePath: string) => {
    const sub = await window.mycast.readSubtitleFile(filePath);
    setMediaQueue((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? {
              ...item,
              subtitlePath: sub.path,
              subtitleName: sub.name,
              subtitleContent: sub.content,
            }
          : item
      )
    );
  }, []);

  const handleDropMediaPaths = useCallback(
    async (filePaths: string[]) => {
      const videoPaths: Array<{ path: string }> = [];
      const subtitlePaths: string[] = [];

      for (const filePath of filePaths) {
        const ext = getFileExtension(filePath);
        if (VIDEO_EXTENSIONS.has(ext)) {
          videoPaths.push({ path: filePath });
        } else if (SUBTITLE_EXTENSIONS.has(ext)) {
          subtitlePaths.push(filePath);
        }
      }

      if (videoPaths.length > 0) {
        await enqueueVideoFiles(videoPaths);
      }

      if (subtitlePaths.length > 0) {
        const targetIdx =
          activeMediaIndexRef.current >= 0 ? activeMediaIndexRef.current : 0;
        if (mediaQueueRef.current.length > 0 || videoPaths.length > 0) {
          try {
            await attachSubtitleFromPath(targetIdx, subtitlePaths[0]);
          } catch (err) {
            setSenderError(err instanceof Error ? err.message : 'Failed to read subtitle file');
          }
        }
      }
    },
    [enqueueVideoFiles, attachSubtitleFromPath]
  );

  const handleAttachSubtitle = useCallback(async (index: number) => {
    try {
      const sub = await window.mycast.pickSubtitleFile();
      if (!sub) return;
      setMediaQueue((prev) =>
        prev.map((item, idx) =>
          idx === index
            ? {
                ...item,
                subtitlePath: sub.path,
                subtitleName: sub.name,
                subtitleContent: sub.content,
              }
            : item
        )
      );
    } catch (err) {
      setSenderError(err instanceof Error ? err.message : 'Failed to load subtitle file');
    }
  }, []);

  const handleClearSubtitle = useCallback((index: number) => {
    setMediaQueue((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? {
              ...item,
              subtitlePath: undefined,
              subtitleName: undefined,
              subtitleContent: undefined,
            }
          : item
      )
    );
  }, []);

  const handleSelectQueueItem = useCallback(
    (index: number) => {
      selectAndPlayIndex(index, true);
    },
    [selectAndPlayIndex]
  );

  const handleMoveQueueItem = useCallback((index: number, direction: -1 | 1) => {
    const target = index + direction;
    setMediaQueue((prev) => {
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setActiveMediaIndex((prevIdx) => {
      if (prevIdx === index) return target;
      if (prevIdx === target) return index;
      return prevIdx;
    });
  }, []);

  const handleRemoveQueueItem = useCallback(
    (index: number) => {
      const currentActive = activeMediaIndexRef.current;
      const prevQueue = mediaQueueRef.current;
      const nextQueue = prevQueue.filter((_, idx) => idx !== index);
      setMediaQueue(nextQueue);

      if (nextQueue.length === 0) {
        setActiveMediaIndex(-1);
        setMediaCurrentTime(0);
        setMediaDuration(0);
        setMediaIsPlaying(false);
        setActiveSubtitleCue(null);
        lastSentCueRef.current = null;
        if (mediaVideoRef.current) {
          mediaVideoRef.current.pause();
          mediaVideoRef.current.removeAttribute('src');
          mediaVideoRef.current.load();
        }
        if (castStateRef.current === 'casting' && castModeRef.current === 'media') {
          senderRef.current?.stopCast(true, 'Queue cleared');
        }
        return;
      }

      if (index < currentActive) {
        setActiveMediaIndex(currentActive - 1);
      } else if (index === currentActive) {
        const nextIdx = Math.min(index, nextQueue.length - 1);
        const shouldPlay =
          castStateRef.current === 'casting' && castModeRef.current === 'media';
        setActiveMediaIndex(nextIdx);
        loadMediaItem(nextQueue[nextIdx], shouldPlay).catch(() => {});
      }
    },
    [loadMediaItem]
  );

  const handleClearQueue = useCallback(() => {
    setMediaQueue([]);
    setActiveMediaIndex(-1);
    setMediaCurrentTime(0);
    setMediaDuration(0);
    setMediaIsPlaying(false);
    setActiveSubtitleCue(null);
    lastSentCueRef.current = null;
    if (mediaVideoRef.current) {
      mediaVideoRef.current.pause();
      mediaVideoRef.current.removeAttribute('src');
      mediaVideoRef.current.load();
    }
    if (castStateRef.current === 'casting' && castModeRef.current === 'media') {
      senderRef.current?.stopCast(true, 'Queue cleared');
    }
  }, []);

  const handleToggleMediaPlayPause = useCallback(async () => {
    const video = mediaVideoRef.current;
    const queue = mediaQueueRef.current;
    if (!video || queue.length === 0) return;

    const idx =
      activeMediaIndexRef.current >= 0 && activeMediaIndexRef.current < queue.length
        ? activeMediaIndexRef.current
        : 0;
    const item = queue[idx];

    if (!video.src || video.src !== item.mediaUrl) {
      await selectAndPlayIndex(idx, true);
      return;
    }

    if (video.paused) {
      await ensureAudioGraph();
      await video.play().catch((err) => {
        setSenderError(err instanceof Error ? err.message : 'Unable to play media');
      });
    } else {
      video.pause();
    }
  }, [ensureAudioGraph, selectAndPlayIndex]);

  const handleMediaSeek = useCallback(
    (timeSec: number) => {
      const video = mediaVideoRef.current;
      if (!video) return;
      const maxDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : timeSec;
      const clamped = Math.max(0, Math.min(timeSec, maxDur));
      video.currentTime = clamped;
      setMediaCurrentTime(clamped);
      syncSubtitleForTime(clamped);
    },
    [syncSubtitleForTime]
  );

  const handleMediaSkipBy = useCallback(
    (deltaSec: number) => {
      const video = mediaVideoRef.current;
      if (!video) return;
      handleMediaSeek((video.currentTime || 0) + deltaSec);
    },
    [handleMediaSeek]
  );

  const handlePrevTrack = useCallback(() => {
    const video = mediaVideoRef.current;
    const queue = mediaQueueRef.current;
    if (queue.length === 0) return;

    if (video && video.currentTime > 3) {
      handleMediaSeek(0);
      return;
    }

    const current = activeMediaIndexRef.current;
    const prevIdx =
      current > 0
        ? current - 1
        : mediaLoopModeRef.current === 'all'
          ? queue.length - 1
          : 0;
    selectAndPlayIndex(prevIdx, true);
  }, [handleMediaSeek, selectAndPlayIndex]);

  const handleNextTrack = useCallback(() => {
    const queue = mediaQueueRef.current;
    if (queue.length === 0) return;
    const nextIdx = computeNextIndex(activeMediaIndexRef.current, queue.length);
    if (nextIdx >= 0) {
      selectAndPlayIndex(nextIdx, true);
    }
  }, [computeNextIndex, selectAndPlayIndex]);

  const handleChangePlaybackRate = useCallback((rate: number) => {
    setMediaPlaybackRate(rate);
    if (mediaVideoRef.current) {
      mediaVideoRef.current.playbackRate = rate;
    }
  }, []);

  const handleCycleLoopMode = useCallback(() => {
    setMediaLoopMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  }, []);

  const handleToggleShuffle = useCallback(() => {
    setMediaShuffle((prev) => !prev);
  }, []);

  const handleSavePlaylist = useCallback(async (name: string) => {
    const queue = mediaQueueRef.current;
    if (queue.length === 0) return;
    const nextPlaylist: SavedPlaylist = {
      id: crypto.randomUUID(),
      name,
      updatedAt: Date.now(),
      items: queue.map((item) => ({
        id: crypto.randomUUID(),
        path: item.path,
        name: item.name,
        subtitlePath: item.subtitlePath,
        subtitleName: item.subtitleName,
      })),
    };
    const updated = await window.mycast.savePlaylists([
      nextPlaylist,
      ...savedPlaylists.filter((p) => p.name.toLowerCase() !== name.toLowerCase()),
    ]);
    setSavedPlaylists(updated);
  }, [savedPlaylists]);

  const handleLoadPlaylist = useCallback(
    async (playlist: SavedPlaylist, mode: 'replace' | 'append') => {
      const loadedItems: MediaQueueItem[] = [];
      for (const plItem of playlist.items) {
        let subtitleContent: string | undefined;
        let subtitleName = plItem.subtitleName;
        let subtitlePath = plItem.subtitlePath;
        if (subtitlePath) {
          try {
            const sub = await window.mycast.readSubtitleFile(subtitlePath);
            subtitleContent = sub.content;
            subtitleName = sub.name;
          } catch {
            subtitlePath = undefined;
            subtitleName = undefined;
          }
        }

        try {
          const mediaUrl = await window.mycast.registerMediaFile(plItem.path);
          const meta = await probeMediaUrl(mediaUrl);
          loadedItems.push({
            id: crypto.randomUUID(),
            path: plItem.path,
            name: plItem.name,
            size: 0,
            mediaUrl,
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
            thumbnailDataUrl: meta.thumbnailDataUrl,
            subtitlePath,
            subtitleName,
            subtitleContent,
          });
        } catch (err) {
          loadedItems.push({
            id: crypto.randomUUID(),
            path: plItem.path,
            name: plItem.name,
            size: 0,
            mediaUrl: '',
            duration: 0,
            width: 0,
            height: 0,
            thumbnailDataUrl: null,
            subtitlePath,
            subtitleName,
            subtitleContent,
            error: err instanceof Error ? err.message : 'Media file missing',
          });
        }
      }

      if (mode === 'replace') {
        setMediaQueue(loadedItems);
        if (loadedItems.length > 0 && loadedItems[0].mediaUrl) {
          setActiveMediaIndex(0);
          const shouldPlay =
            castStateRef.current === 'casting' && castModeRef.current === 'media';
          await loadMediaItem(loadedItems[0], shouldPlay).catch(() => {});
        } else {
          setActiveMediaIndex(loadedItems.length > 0 ? 0 : -1);
        }
      } else {
        const wasEmpty = mediaQueueRef.current.length === 0;
        const startOffset = mediaQueueRef.current.length;
        setMediaQueue((prev) => [...prev, ...loadedItems]);
        if (wasEmpty && loadedItems.length > 0 && loadedItems[0].mediaUrl) {
          setActiveMediaIndex(startOffset);
          await loadMediaItem(loadedItems[0], false).catch(() => {});
        }
      }
    },
    [loadMediaItem]
  );

  const handleDeletePlaylist = useCallback(
    async (playlistId: string) => {
      const updated = await window.mycast.savePlaylists(
        savedPlaylists.filter((p) => p.id !== playlistId)
      );
      setSavedPlaylists(updated);
    },
    [savedPlaylists]
  );

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
  const showCrossTabCastBar =
    castState === 'casting' &&
    activeTab !== 'receiver' &&
    ((castMode === 'screen' && activeTab !== 'cast') ||
      (castMode === 'media' && activeTab !== 'media'));

  return (
    <div className="app-shell">
      {/* Persistent hidden media element so playback survives tab switches */}
      <video
        ref={mediaVideoRef}
        crossOrigin="anonymous"
        playsInline
        style={{ display: 'none' }}
      />

      {!hideSidebar && (
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          selfInfo={selfInfo}
          peerCount={peers.length}
          webReceiverCount={webReceivers.length}
          isCasting={castState === 'casting'}
          castMode={castMode}
          isReceiving={Boolean(remoteStream)}
        />
      )}

      <main className="main-content">
        {showCrossTabCastBar && (
          <div className="active-cast-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span className="status-dot busy" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {castMode === 'media'
                    ? `Casting Media${activeMediaItem ? `: ${activeMediaItem.name}` : ''}`
                    : 'Casting Screen'}
                </div>
                {senderStats && (
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                    {senderStats.width > 0 ? `${senderStats.width}×${senderStats.height}` : 'Live'} •{' '}
                    {senderStats.fps}fps • {senderStats.bitrateMbps.toFixed(1)} Mbps
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm"
                onClick={castMode === 'media' ? handleToggleMediaPlayPause : handleToggleVideoPaused}
              >
                {castMode === 'media' ? (
                  mediaIsPlaying ? <Pause size={14} /> : <Play size={14} />
                ) : videoPaused ? (
                  <Play size={14} />
                ) : (
                  <Pause size={14} />
                )}
                <span>
                  {castMode === 'media'
                    ? mediaIsPlaying
                      ? 'Pause'
                      : 'Play'
                    : videoPaused
                      ? 'Resume'
                      : 'Pause'}
                </span>
              </button>
              <button className="btn btn-sm" onClick={handleToggleAudioMuted}>
                {audioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                <span>{audioMuted ? 'Unmute' : 'Mute'}</span>
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setActiveTab(castMode === 'media' ? 'media' : 'cast')}
              >
                <ArrowUpRight size={14} />
                <span>Controls</span>
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleStopCast}>
                <Square size={13} />
                <span>Stop</span>
              </button>
            </div>
          </div>
        )}

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
            castState={
              castMode === 'screen'
                ? castState
                : castState === 'connecting'
                  ? 'connecting'
                  : 'stopped'
            }
            videoPaused={videoPaused}
            audioMuted={audioMuted}
            stats={castMode === 'screen' ? senderStats : null}
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

        {activeTab === 'media' && (
          <MediaView
            selfInfo={selfInfo}
            peers={peers}
            selectedPeerId={selectedPeerId}
            onSelectPeer={setSelectedPeerId}
            quality={quality}
            onChangeQuality={handleQualityChange}
            pinInput={pinInput}
            onChangePinInput={setPinInput}
            castState={castState}
            castMode={castMode}
            audioMuted={audioMuted}
            stats={senderStats}
            warning={senderWarning}
            error={senderError}
            onDismissWarning={() => setSenderWarning(null)}
            onDismissError={() => setSenderError(null)}
            onRefreshPeers={() => window.mycast.refreshDiscovery()}
            onAddManualPeer={handleAddManualPeer}
            onRemoveManualPeer={handleRemoveManualPeer}
            queue={mediaQueue}
            activeIndex={activeMediaIndex}
            isPlaying={mediaIsPlaying}
            currentTime={mediaCurrentTime}
            duration={mediaDuration}
            playbackRate={mediaPlaybackRate}
            loopMode={mediaLoopMode}
            shuffle={mediaShuffle}
            activeSubtitleCue={activeSubtitleCue}
            savedPlaylists={savedPlaylists}
            onAddFiles={handleAddMediaFiles}
            onDropPaths={handleDropMediaPaths}
            onSelectQueueItem={handleSelectQueueItem}
            onMoveQueueItem={handleMoveQueueItem}
            onRemoveQueueItem={handleRemoveQueueItem}
            onClearQueue={handleClearQueue}
            onAttachSubtitle={handleAttachSubtitle}
            onClearSubtitle={handleClearSubtitle}
            onTogglePlayPause={handleToggleMediaPlayPause}
            onSeek={handleMediaSeek}
            onSkipBy={handleMediaSkipBy}
            onPrevTrack={handlePrevTrack}
            onNextTrack={handleNextTrack}
            onChangePlaybackRate={handleChangePlaybackRate}
            onCycleLoopMode={handleCycleLoopMode}
            onToggleShuffle={handleToggleShuffle}
            onToggleAudioMuted={handleToggleAudioMuted}
            onStartMediaCast={handleStartMediaCast}
            onStopCast={handleStopCast}
            onSavePlaylist={handleSavePlaylist}
            onLoadPlaylist={handleLoadPlaylist}
            onDeletePlaylist={handleDeletePlaylist}
          />
        )}

        {activeTab === 'receiver' && (
          <ReceiverView
            selfInfo={selfInfo}
            stream={remoteStream}
            senderName={receiverSenderName}
            stats={receiverStats}
            subtitleText={receiverSubtitleText}
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
