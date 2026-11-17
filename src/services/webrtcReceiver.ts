import { SignalingMessage, StreamStats } from '../types/mycast';

export interface ReceiverCallbacks {
  onIncomingCast: (info: { sessionId: string; senderId?: string; senderName: string }) => void;
  onStream: (stream: MediaStream) => void;
  onStats: (stats: StreamStats) => void;
  onCastEnded: (reason?: string) => void;
}

export class WebRtcReceiverController {
  private pc: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private activeSessionId: string | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private statsTimer: number | null = null;
  private prevBytes = 0;
  private prevTs = 0;
  private readonly callbacks: ReceiverCallbacks;

  constructor(callbacks: ReceiverCallbacks) {
    this.callbacks = callbacks;
  }

  public getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  public async handleSignalingMessage(msg: SignalingMessage): Promise<void> {
    if (msg.type === 'cast-request') {
      if (this.activeSessionId && this.activeSessionId !== msg.sessionId) {
        this.cleanup(false);
      }

      this.activeSessionId = msg.sessionId;
      this.pendingIce = [];
      this.remoteStream = new MediaStream();

      const pc = new RTCPeerConnection({ iceServers: [] });
      this.pc = pc;

      pc.ontrack = (event) => {
        try {
          const receiver = event.receiver as RTCRtpReceiver & { playoutDelayHint?: number };
          if (receiver && 'playoutDelayHint' in receiver) {
            receiver.playoutDelayHint = 0;
          }
        } catch {
          // Ignore if unsupported
        }

        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        if (event.streams && event.streams[0]) {
          this.remoteStream = event.streams[0];
        } else {
          this.remoteStream.addTrack(event.track);
        }
        this.callbacks.onStream(this.remoteStream);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && this.activeSessionId) {
          window.mycast.sendReceiverSignaling({
            type: 'webrtc-ice',
            sessionId: this.activeSessionId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (!this.pc) return;
        if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
          this.disconnect('Connection lost');
        }
      };

      this.callbacks.onIncomingCast({
        sessionId: msg.sessionId,
        senderId: msg.senderId,
        senderName: msg.senderName || 'Remote PC',
      });

      this.startStatsPolling();

      window.mycast.sendReceiverSignaling({
        type: 'cast-accepted',
        sessionId: msg.sessionId,
      });
      return;
    }

    if (!this.activeSessionId || msg.sessionId !== this.activeSessionId) return;

    if (msg.type === 'webrtc-offer' && this.pc && msg.sdp) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      while (this.pendingIce.length > 0) {
        const candidate = this.pendingIce.shift()!;
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      window.mycast.sendReceiverSignaling({
        type: 'webrtc-answer',
        sessionId: this.activeSessionId,
        sdp: this.pc.localDescription?.toJSON(),
      });
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
      this.cleanup(false, msg.reason);
    }
  }

  public disconnect(reason = 'Disconnected by receiver'): void {
    if (!this.activeSessionId) return;
    window.mycast.sendReceiverSignaling({
      type: 'cast-stop',
      sessionId: this.activeSessionId,
      reason,
    });
    this.cleanup(true, reason);
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
        let jitterMs = 0;
        let rttMs = 0;
        let codec = '';

        report.forEach((stat) => {
          if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
            width = stat.frameWidth || width;
            height = stat.frameHeight || height;
            fps = stat.framesPerSecond || fps;
            bytes = stat.bytesReceived || 0;
            ts = stat.timestamp || 0;
            jitterMs = typeof stat.jitter === 'number' ? Math.round(stat.jitter * 1000) : 0;
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
          jitterMs,
          codec,
        });
      } catch {
        // Ignore transient stats errors
      }
    }, 1000);
  }

  private cleanup(_initiatedLocally: boolean, reason?: string): void {
    if (this.statsTimer) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // ignore
      }
      this.pc = null;
    }
    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) {
        track.stop();
      }
      this.remoteStream = null;
    }
    const hadSession = Boolean(this.activeSessionId);
    this.activeSessionId = null;
    this.pendingIce = [];
    this.prevBytes = 0;
    this.prevTs = 0;

    if (hadSession) {
      this.callbacks.onCastEnded(reason);
    }
  }
}
