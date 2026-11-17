import { DiscoveredPeer, QualityPreset, SignalingMessage, StreamStats } from '../types/mycast';

export interface SenderCallbacks {
  onStateChange: (state: 'connecting' | 'casting' | 'stopped', message?: string) => void;
  onStats: (stats: StreamStats) => void;
  onWarning: (warning: string) => void;
  onError: (error: string) => void;
}

interface CaptureResult {
  stream: MediaStream;
  audioActive: boolean;
  warning?: string;
}

function getResolutionBounds(resolution: QualityPreset['resolution']): {
  maxWidth: number;
  maxHeight: number;
} {
  switch (resolution) {
    case '720p':
      return { maxWidth: 1280, maxHeight: 720 };
    case '1080p':
      return { maxWidth: 1920, maxHeight: 1080 };
    case 'native':
    default:
      return { maxWidth: 3840, maxHeight: 2160 };
  }
}

async function captureDesktopStream(
  sourceId: string,
  quality: QualityPreset
): Promise<CaptureResult> {
  const { maxWidth, maxHeight } = getResolutionBounds(quality.resolution);

  const videoMandatory: Record<string, unknown> = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: sourceId,
    maxWidth,
    maxHeight,
    maxFrameRate: quality.fps,
  };

  if (quality.includeAudio) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          },
        } as unknown as MediaTrackConstraints,
        video: {
          mandatory: videoMandatory,
        } as unknown as MediaTrackConstraints,
      });

      const hasAudioTrack = stream.getAudioTracks().length > 0;
      return {
        stream,
        audioActive: hasAudioTrack,
        warning: hasAudioTrack
          ? undefined
          : 'No system audio track returned for this source — casting video only.',
      };
    } catch {
      // Fallback to video-only capture if desktop loopback audio fails (e.g. window capture or no audio output)
      const videoOnlyStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: videoMandatory,
        } as unknown as MediaTrackConstraints,
      });

      return {
        stream: videoOnlyStream,
        audioActive: false,
        warning:
          'System audio capture is unavailable for this source — casting video only.',
      };
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: videoMandatory,
    } as unknown as MediaTrackConstraints,
  });

  return { stream, audioActive: false };
}

export class WebRtcSenderController {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private audioSender: RTCRtpSender | null = null;
  private sessionId: string | null = null;
  private currentQuality: QualityPreset | null = null;
  private currentSourceId: string | null = null;
  private statsTimer: number | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private prevBytes = 0;
  private prevTs = 0;
  private isStopping = false;
  private castMode: 'screen' | 'media' = 'screen';
  private ownsStreamTracks = true;

  private readonly callbacks: SenderCallbacks;

  constructor(callbacks: SenderCallbacks) {
    this.callbacks = callbacks;
  }

  public getCastMode(): 'screen' | 'media' {
    return this.castMode;
  }

  public async startCast(params: {
    target: DiscoveredPeer;
    sourceId: string;
    quality: QualityPreset;
    selfId: string;
    selfName: string;
    selfPort: number;
    pin?: string;
  }): Promise<{ audioActive: boolean }> {
    await this.stopCast(false);
    this.isStopping = false;
    this.castMode = 'screen';
    this.ownsStreamTracks = true;

    const { target, sourceId, quality, selfId, selfName, selfPort, pin } = params;
    this.currentQuality = { ...quality };
    this.currentSourceId = sourceId;
    this.sessionId = crypto.randomUUID();
    this.callbacks.onStateChange('connecting', `Connecting to ${target.name}...`);

    // 1. Capture screen/window stream first so user gets immediate capture errors if any
    let capture: CaptureResult;
    try {
      capture = await captureDesktopStream(sourceId, quality);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to capture screen/window';
      this.callbacks.onError(msg);
      this.callbacks.onStateChange('stopped');
      throw err;
    }

    this.localStream = capture.stream;
    if (capture.warning) {
      this.callbacks.onWarning(capture.warning);
    }

    // Listen if user stops sharing externally or window closes
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = 'motion';
      videoTrack.onended = () => {
        if (!this.isStopping) {
          this.stopCast(true, 'Capture source closed');
        }
      };
    }

    // 2. Open WebSocket signaling connection
    const wsUrl = this.buildWsUrl(target, selfPort);

    try {
      await this.connectAndNegotiate({
        wsUrl,
        sessionId: this.sessionId,
        senderId: selfId,
        senderName: selfName,
        pin,
        quality,
      });
      return { audioActive: capture.audioActive };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cast connection failed';
      await this.stopCast(false);
      this.callbacks.onError(msg);
      this.callbacks.onStateChange('stopped');
      throw err;
    }
  }

  public async startMediaCast(params: {
    target: DiscoveredPeer;
    stream: MediaStream;
    quality: QualityPreset;
    selfId: string;
    selfName: string;
    selfPort: number;
    pin?: string;
  }): Promise<void> {
    await this.stopCast(false);
    this.isStopping = false;
    this.castMode = 'media';
    this.ownsStreamTracks = false;

    const { target, stream, quality, selfId, selfName, selfPort, pin } = params;
    this.currentQuality = { ...quality };
    this.currentSourceId = null;
    this.sessionId = crypto.randomUUID();
    this.localStream = stream;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = 'motion';
    }

    this.callbacks.onStateChange('connecting', `Connecting to ${target.name}...`);

    const wsUrl = this.buildWsUrl(target, selfPort);
    try {
      await this.connectAndNegotiate({
        wsUrl,
        sessionId: this.sessionId,
        senderId: selfId,
        senderName: selfName,
        pin,
        quality,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Media cast connection failed';
      await this.stopCast(false);
      this.callbacks.onError(msg);
      this.callbacks.onStateChange('stopped');
      throw err;
    }
  }

  public async replaceMediaVideoTrack(newVideoTrack: MediaStreamTrack | null): Promise<void> {
    if (newVideoTrack) {
      newVideoTrack.contentHint = 'motion';
    }
    if (this.localStream) {
      for (const track of this.localStream.getVideoTracks()) {
        this.localStream.removeTrack(track);
      }
      if (newVideoTrack) {
        this.localStream.addTrack(newVideoTrack);
      }
    }
    if (this.videoSender) {
      await this.videoSender.replaceTrack(newVideoTrack);
    }
  }

  public sendSubtitleCue(subtitleText: string | null): void {
    if (this.sessionId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWs({
        type: 'subtitle-cue',
        sessionId: this.sessionId,
        subtitleText,
      });
    }
  }

  private buildWsUrl(target: DiscoveredPeer, selfPort: number): string {
    if (target.isWebReceiver && target.webClientId) {
      return `ws://127.0.0.1:${selfPort}/ws?role=sender&targetClientId=${encodeURIComponent(target.webClientId)}`;
    }
    if (target.isLoopback) {
      return `ws://127.0.0.1:${selfPort}/ws?role=sender`;
    }
    return `ws://${target.ip}:${target.port}/ws?role=sender`;
  }

  private connectAndNegotiate(opts: {
    wsUrl: string;
    sessionId: string;
    senderId: string;
    senderName: string;
    pin?: string;
    quality: QualityPreset;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(opts.wsUrl);
      this.ws = ws;

      const handshakeTimeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Receiver did not respond in time'));
        }
      }, 9000);

      ws.onopen = () => {
        this.sendWs({
          type: 'cast-request',
          sessionId: opts.sessionId,
          senderId: opts.senderId,
          senderName: opts.senderName,
          pin: opts.pin,
          quality: opts.quality,
        });
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(handshakeTimeout);
          reject(new Error('Could not connect to receiver WebSocket'));
        }
      };

      ws.onclose = () => {
        if (!settled) {
          settled = true;
          clearTimeout(handshakeTimeout);
          reject(new Error('Connection closed by receiver'));
          return;
        }
        if (!this.isStopping) {
          this.stopCast(false, 'Receiver connection closed');
        }
      };

      ws.onmessage = async (event) => {
        let msg: SignalingMessage;
        try {
          msg = JSON.parse(event.data as string) as SignalingMessage;
        } catch {
          return;
        }

        if (msg.sessionId && msg.sessionId !== opts.sessionId) return;

        if (msg.type === 'cast-rejected') {
          if (!settled) {
            settled = true;
            clearTimeout(handshakeTimeout);
            reject(new Error(msg.reason || 'Cast was rejected by receiver'));
          }
          return;
        }

        if (msg.type === 'cast-accepted') {
          if (!settled) {
            settled = true;
            clearTimeout(handshakeTimeout);
            try {
              await this.startPeerConnection(opts.sessionId, opts.quality);
              this.callbacks.onStateChange('casting');
              resolve();
            } catch (err) {
              reject(err);
            }
          }
          return;
        }

        if (msg.type === 'webrtc-answer' && this.pc && msg.sdp) {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          while (this.pendingIce.length > 0) {
            const c = this.pendingIce.shift()!;
            await this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          return;
        }

        if (msg.type === 'webrtc-ice' && this.pc && msg.candidate) {
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
          } else {
            this.pendingIce.push(msg.candidate);
          }
          return;
        }

        if (msg.type === 'cast-stop') {
          this.stopCast(false, msg.reason || 'Receiver stopped the cast');
        }
      };
    });
  }

  private async startPeerConnection(sessionId: string, quality: QualityPreset): Promise<void> {
    if (!this.localStream) throw new Error('No local capture stream available');

    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    this.pendingIce = [];

    const videoTrack = this.localStream.getVideoTracks()[0];
    const audioTrack = this.localStream.getAudioTracks()[0];

    if (videoTrack) {
      this.videoSender = pc.addTrack(videoTrack, this.localStream);
      this.preferHardwareVideoCodecs(pc, this.videoSender);
      await this.applyEncodingQuality(this.videoSender, quality);
    }
    if (audioTrack) {
      this.audioSender = pc.addTrack(audioTrack, this.localStream);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWs({
          type: 'webrtc-ice',
          sessionId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        if (!this.isStopping) {
          this.stopCast(true, 'WebRTC connection lost');
        }
      }
    };

    const offer = await pc.createOffer();
    const tunedSdp = offer.sdp
      ? this.tuneSdpVideoBitrate(offer.sdp, quality.bitrateMbps)
      : offer.sdp;
    await pc.setLocalDescription({ type: offer.type, sdp: tunedSdp });

    this.sendWs({
      type: 'webrtc-offer',
      sessionId,
      sdp: pc.localDescription?.toJSON(),
    });

    this.startStatsPolling();
  }

  private preferHardwareVideoCodecs(pc: RTCPeerConnection, videoSender: RTCRtpSender): void {
    try {
      const capabilities = RTCRtpReceiver.getCapabilities('video');
      if (!capabilities?.codecs?.length) return;

      const transceiver = pc.getTransceivers().find((t) => t.sender === videoSender);
      if (!transceiver || typeof transceiver.setCodecPreferences !== 'function') return;

      const codecScore = (mimeType: string, sdpFmtpLine = ''): number => {
        const mime = mimeType.toLowerCase();
        if (mime === 'video/h264') {
          // Prefer constrained baseline / high profile with packetization-mode=1 for GPU HW encode
          if (sdpFmtpLine.includes('packetization-mode=1')) return 0;
          return 1;
        }
        if (mime === 'video/vp9') return 2;
        if (mime === 'video/av1') return 3;
        if (mime === 'video/vp8') return 4;
        return 5; // rtx, red, ulpfec
      };

      const sorted = [...capabilities.codecs].sort(
        (a, b) => codecScore(a.mimeType, a.sdpFmtpLine) - codecScore(b.mimeType, b.sdpFmtpLine)
      );
      transceiver.setCodecPreferences(sorted);
    } catch {
      // Ignore if browser/platform rejects custom codec preferences
    }
  }

  private tuneSdpVideoBitrate(sdp: string, bitrateMbps: number): string {
    const maxKbps = bitrateMbps * 1000;
    const startKbps = Math.min(maxKbps, Math.max(2500, Math.round(maxKbps * 0.65)));
    const minKbps = Math.min(startKbps, 1500);
    const lines = sdp.split('\r\n');
    const out: string[] = [];
    let inVideo = false;
    let addedBandwidth = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('m=video ')) {
        inVideo = true;
        addedBandwidth = false;
        out.push(line);
        continue;
      }
      if (line.startsWith('m=')) {
        inVideo = false;
        out.push(line);
        continue;
      }

      if (inVideo) {
        if (line.startsWith('b=AS:')) {
          out.push(`b=AS:${maxKbps}`);
          addedBandwidth = true;
          continue;
        }
        if (line.startsWith('c=IN ') && !addedBandwidth) {
          out.push(line);
          out.push(`b=AS:${maxKbps}`);
          addedBandwidth = true;
          continue;
        }
        if (line.startsWith('a=fmtp:') && !line.includes('apt=') && !line.includes('x-google-start-bitrate')) {
          out.push(
            `${line};x-google-min-bitrate=${minKbps};x-google-start-bitrate=${startKbps};x-google-max-bitrate=${maxKbps}`
          );
          continue;
        }
      }

      out.push(line);
    }

    return out.join('\r\n');
  }

  private async applyEncodingQuality(sender: RTCRtpSender, quality: QualityPreset): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = quality.bitrateMbps * 1_000_000;
      params.encodings[0].maxFramerate = quality.fps;
      params.encodings[0].networkPriority = 'high';
      params.degradationPreference = 'maintain-framerate';
      await sender.setParameters(params);
    } catch {
      // Some platforms ignore specific encoding hints; non-fatal
    }
  }

  public async updateQuality(quality: QualityPreset): Promise<void> {
    this.currentQuality = { ...quality };
    if (this.videoSender) {
      await this.applyEncodingQuality(this.videoSender, quality);
    }
  }

  public async switchSource(newSourceId: string): Promise<void> {
    if (!this.pc || !this.videoSender || !this.currentQuality) return;
    if (newSourceId === this.currentSourceId) return;

    const capture = await captureDesktopStream(newSourceId, this.currentQuality);
    if (capture.warning) {
      this.callbacks.onWarning(capture.warning);
    }

    const newVideoTrack = capture.stream.getVideoTracks()[0];
    const newAudioTrack = capture.stream.getAudioTracks()[0] || null;

    if (newVideoTrack) {
      newVideoTrack.contentHint = 'motion';
      newVideoTrack.onended = () => {
        if (!this.isStopping) {
          this.stopCast(true, 'Capture source closed');
        }
      };
      await this.videoSender.replaceTrack(newVideoTrack);
    }

    if (this.audioSender) {
      await this.audioSender.replaceTrack(newAudioTrack);
    }

    // Stop previous tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
    }

    this.localStream = capture.stream;
    this.currentSourceId = newSourceId;
  }

  public setVideoPaused(paused: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = !paused;
    }
  }

  public setAudioMuted(muted: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  private startStatsPolling(): void {
    if (this.statsTimer) {
      window.clearInterval(this.statsTimer);
    }
    this.prevBytes = 0;
    this.prevTs = 0;

    this.statsTimer = window.setInterval(async () => {
      if (!this.pc) return;
      try {
        const report = await this.pc.getStats();
        let width = 0;
        let height = 0;
        let fps = 0;
        let bytes = 0;
        let ts = 0;
        let rttMs = 0;
        let codec = '';
        let qualityLimitationReason = '';

        report.forEach((stat) => {
          if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
            width = stat.frameWidth || width;
            height = stat.frameHeight || height;
            fps = stat.framesPerSecond || fps;
            bytes = stat.bytesSent || 0;
            ts = stat.timestamp || 0;
            const limitation = (stat as { qualityLimitationReason?: string }).qualityLimitationReason;
            if (limitation) qualityLimitationReason = limitation;
            if (stat.codecId) {
              const codecStat = report.get(stat.codecId) as { mimeType?: string } | undefined;
              if (codecStat?.mimeType) codec = codecStat.mimeType;
            }
          }
          if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
            if (typeof stat.currentRoundTripTime === 'number') {
              rttMs = Math.round(stat.currentRoundTripTime * 1000);
            }
          }
        });

        let bitrateMbps = 0;
        if (this.prevTs > 0 && ts > this.prevTs && bytes >= this.prevBytes) {
          bitrateMbps = ((bytes - this.prevBytes) * 8) / ((ts - this.prevTs) * 1000);
        }
        this.prevBytes = bytes;
        this.prevTs = ts;

        this.callbacks.onStats({
          width,
          height,
          fps: Math.round(fps),
          bitrateMbps: Number(bitrateMbps.toFixed(2)),
          rttMs,
          jitterMs: 0,
          codec,
          qualityLimitationReason,
        });
      } catch {
        // Ignore transient stats errors during teardown
      }
    }, 1000);
  }

  public async stopCast(notifyRemote = true, message?: string): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;

    if (notifyRemote && this.sessionId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWs({
        type: 'cast-stop',
        sessionId: this.sessionId,
        reason: message || 'Stopped by sender',
      });
    }

    if (this.statsTimer) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.onended = null;
        if (this.ownsStreamTracks) {
          track.stop();
        }
      }
      this.localStream = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // ignore
      }
      this.pc = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    this.videoSender = null;
    this.audioSender = null;
    this.sessionId = null;
    this.pendingIce = [];
    this.callbacks.onStateChange('stopped', message);
  }

  private sendWs(msg: SignalingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
