import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { getPrimaryLanIp } from './discovery';
import { AppConfig, DiscoveredPeer, ReceiverStatus, SignalingMessage } from './types';

export const DEFAULT_PORT = 48900;

interface WebReceiverEntry {
  clientId: string;
  ws: WebSocket;
  name: string;
  ip: string;
  pinRequired: boolean;
  status: ReceiverStatus;
  connectedAt: number;
  activeSenderId: string | null;
  activeSessionId: string | null;
}

interface SenderEntry {
  socketId: string;
  ws: WebSocket;
  targetClientId: string | null;
  activeSessionId: string | null;
}

export interface SignalingServerOptions {
  selfId: string;
  getConfig: () => AppConfig;
  getStatus: () => ReceiverStatus;
  preferredPort?: number;
}

function normalizeRemoteIp(addr?: string): string {
  if (!addr) return '127.0.0.1';
  if (addr.startsWith('::ffff:')) return addr.slice(7);
  if (addr === '::1') return '127.0.0.1';
  return addr;
}

export class SignalingServer extends EventEmitter {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private boundPort = 0;
  private readonly selfId: string;
  private readonly getConfig: () => AppConfig;
  private readonly getStatus: () => ReceiverStatus;
  private readonly preferredPort: number;

  private webReceivers = new Map<string, WebReceiverEntry>();
  private senders = new Map<string, SenderEntry>();
  private activeLocalSession: { sessionId: string; senderSocketId: string } | null = null;

  constructor(options: SignalingServerOptions) {
    super();
    this.selfId = options.selfId;
    this.getConfig = options.getConfig;
    this.getStatus = options.getStatus;
    this.preferredPort = options.preferredPort || DEFAULT_PORT;
  }

  public getPort(): number {
    return this.boundPort;
  }

  public getWebReceiverPeers(): DiscoveredPeer[] {
    return Array.from(this.webReceivers.values()).map((entry) => ({
      id: entry.clientId,
      name: `${entry.name} (Browser)`,
      hostname: entry.ip,
      ip: getPrimaryLanIp(),
      port: this.boundPort,
      pinRequired: entry.pinRequired,
      status: entry.status,
      lastSeen: Date.now(),
      isWebReceiver: true,
      webClientId: entry.clientId,
    }));
  }

  public async start(): Promise<number> {
    if (this.server && this.boundPort > 0) return this.boundPort;

    let port = this.preferredPort;
    const maxAttempts = 20;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.tryListen(port);
        this.boundPort = port;
        return port;
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'EADDRINUSE') {
          port++;
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Could not bind HTTP/WS server starting at port ${this.preferredPort}`);
  }

  private tryListen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttpRequest(req, res));

      const onError = (err: Error) => {
        server.close();
        reject(err);
      };

      server.once('error', onError);

      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', onError);
        const wss = new WebSocketServer({ server, path: '/ws' });
        wss.on('error', (err) => {
          console.error('[Signaling] WebSocketServer error:', err.message);
        });
        server.on('error', (err) => {
          console.error('[Signaling] HTTP server error:', err.message);
        });
        this.server = server;
        this.wss = wss;
        this.setupWebSocketServer(wss);
        resolve();
      });
    });
  }

  public stop(): void {
    for (const sender of this.senders.values()) {
      try {
        sender.ws.close();
      } catch {
        // ignore
      }
    }
    for (const wr of this.webReceivers.values()) {
      try {
        wr.ws.close();
      } catch {
        // ignore
      }
    }
    this.senders.clear();
    this.webReceivers.clear();
    this.activeLocalSession = null;

    if (this.wss) {
      try {
        this.wss.close();
      } catch {
        // ignore
      }
      this.wss = null;
    }

    if (this.server) {
      try {
        this.server.close();
      } catch {
        // ignore
      }
      this.server = null;
    }
    this.boundPort = 0;
  }

  private resolveWebReceiverHtmlPath(): string | null {
    const candidates = [
      path.join(__dirname, '../dist/web-receiver.html'),
      path.join(__dirname, '../public/web-receiver.html'),
      path.join(process.cwd(), 'public/web-receiver.html'),
      path.join(process.cwd(), 'dist/web-receiver.html'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (reqUrl.pathname === '/api/info') {
      const cfg = this.getConfig();
      const payload = {
        id: this.selfId,
        name: cfg.deviceName,
        hostname: os.hostname(),
        ip: getPrimaryLanIp(),
        port: this.boundPort,
        pinRequired: cfg.pinRequired,
        status: this.getStatus(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html' || reqUrl.pathname === '/web-receiver.html') {
      const htmlPath = this.resolveWebReceiverHtmlPath();
      if (!htmlPath) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('web-receiver.html asset not found');
        return;
      }
      fs.readFile(htmlPath, 'utf8', (err, html) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Failed to read web receiver page');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }

  private setupWebSocketServer(wss: WebSocketServer): void {
    wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
      const role = url.searchParams.get('role') || 'sender';
      const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);

      if (role === 'web-receiver') {
        this.handleWebReceiverConnection(ws, url, remoteIp);
      } else {
        this.handleSenderConnection(ws, url);
      }
    });
  }

  private handleWebReceiverConnection(ws: WebSocket, url: URL, remoteIp: string): void {
    const clientId = `web-${crypto.randomUUID()}`;
    const rawName = url.searchParams.get('name')?.trim();
    const entry: WebReceiverEntry = {
      clientId,
      ws,
      name: rawName || `Web Player (${remoteIp})`,
      ip: remoteIp,
      pinRequired: false,
      status: 'idle',
      connectedAt: Date.now(),
      activeSenderId: null,
      activeSessionId: null,
    };

    this.webReceivers.set(clientId, entry);
    this.sendJson(ws, { type: 'registered', clientId, hostName: this.getConfig().deviceName });
    this.emit('web-receivers-updated', this.getWebReceiverPeers());

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString('utf8'));
        if (msg.type === 'web-receiver-meta') {
          if (typeof msg.name === 'string' && msg.name.trim()) {
            entry.name = msg.name.trim().slice(0, 48);
          }
          if (msg.status === 'idle' || msg.status === 'receiving') {
            entry.status = msg.status;
          }
          this.emit('web-receivers-updated', this.getWebReceiverPeers());
          return;
        }

        // Forward signaling messages from Web Receiver back to its paired Sender
        if (entry.activeSenderId) {
          const sender = this.senders.get(entry.activeSenderId);
          if (sender && sender.ws.readyState === WebSocket.OPEN) {
            this.sendJson(sender.ws, msg);
          }
        }

        if (msg.type === 'cast-stop' || msg.type === 'cast-rejected') {
          entry.status = 'idle';
          entry.activeSenderId = null;
          entry.activeSessionId = null;
          this.emit('web-receivers-updated', this.getWebReceiverPeers());
        } else if (msg.type === 'cast-accepted') {
          entry.status = 'receiving';
          this.emit('web-receivers-updated', this.getWebReceiverPeers());
        }
      } catch {
        // Ignore malformed message
      }
    });

    ws.on('close', () => {
      if (entry.activeSenderId) {
        const sender = this.senders.get(entry.activeSenderId);
        if (sender && sender.ws.readyState === WebSocket.OPEN) {
          this.sendJson(sender.ws, {
            type: 'cast-stop',
            sessionId: entry.activeSessionId || '',
            reason: 'Browser receiver disconnected',
          });
        }
      }
      this.webReceivers.delete(clientId);
      this.emit('web-receivers-updated', this.getWebReceiverPeers());
    });
  }

  private handleSenderConnection(ws: WebSocket, url: URL): void {
    const socketId = `sender-${crypto.randomUUID()}`;
    const targetClientId = url.searchParams.get('targetClientId') || null;
    const senderEntry: SenderEntry = {
      socketId,
      ws,
      targetClientId,
      activeSessionId: null,
    };
    this.senders.set(socketId, senderEntry);

    ws.on('message', (data) => {
      let msg: SignalingMessage;
      try {
        msg = JSON.parse(data.toString('utf8')) as SignalingMessage;
      } catch {
        return;
      }

      if (!msg || typeof msg.type !== 'string') return;

      // Flow B: Relay to a connected Web Browser Receiver
      if (senderEntry.targetClientId) {
        const wr = this.webReceivers.get(senderEntry.targetClientId);
        if (!wr || wr.ws.readyState !== WebSocket.OPEN) {
          this.sendJson(ws, {
            type: 'cast-rejected',
            sessionId: msg.sessionId || '',
            reason: 'Browser receiver is not connected',
          });
          return;
        }

        if (msg.type === 'cast-request') {
          // If another sender was casting to this web receiver, notify it to stop
          if (wr.activeSenderId && wr.activeSenderId !== socketId) {
            const prevSender = this.senders.get(wr.activeSenderId);
            if (prevSender && prevSender.ws.readyState === WebSocket.OPEN) {
              this.sendJson(prevSender.ws, {
                type: 'cast-stop',
                sessionId: wr.activeSessionId || '',
                reason: 'Replaced by another cast',
              });
            }
          }
          wr.activeSenderId = socketId;
          wr.activeSessionId = msg.sessionId;
          senderEntry.activeSessionId = msg.sessionId;
        } else {
          if (
            wr.activeSenderId !== socketId ||
            (wr.activeSessionId && msg.sessionId && msg.sessionId !== wr.activeSessionId)
          ) {
            return;
          }
          if (msg.type === 'cast-stop') {
            wr.status = 'idle';
            wr.activeSenderId = null;
            wr.activeSessionId = null;
            this.emit('web-receivers-updated', this.getWebReceiverPeers());
          }
        }

        this.sendJson(wr.ws, msg);
        return;
      }

      // Flow A: Local Desktop Receiver
      if (msg.type === 'cast-request') {
        const config = this.getConfig();
        if (config.pinRequired) {
          const suppliedPin = (msg.pin || '').trim();
          if (suppliedPin !== config.pinCode) {
            this.sendJson(ws, {
              type: 'cast-rejected',
              sessionId: msg.sessionId,
              reason: 'Invalid PIN code',
            });
            return;
          }
        }

        // Stop any previous active local cast session if it's a different session
        if (this.activeLocalSession && this.activeLocalSession.sessionId !== msg.sessionId) {
          const prevSender = this.senders.get(this.activeLocalSession.senderSocketId);
          if (prevSender && prevSender.ws.readyState === WebSocket.OPEN) {
            this.sendJson(prevSender.ws, {
              type: 'cast-stop',
              sessionId: this.activeLocalSession.sessionId,
              reason: 'Replaced by a new incoming cast',
            });
          }
          this.emit('receiver-signaling', {
            type: 'cast-stop',
            sessionId: this.activeLocalSession.sessionId,
            reason: 'Replaced by a new incoming cast',
          } satisfies SignalingMessage);
        }

        senderEntry.activeSessionId = msg.sessionId;
        this.activeLocalSession = {
          sessionId: msg.sessionId,
          senderSocketId: socketId,
        };
        this.emit('receiver-signaling', msg);
        return;
      }

      if (!this.activeLocalSession || msg.sessionId !== this.activeLocalSession.sessionId) {
        return;
      }

      this.emit('receiver-signaling', msg);
      if (msg.type === 'cast-stop') {
        this.activeLocalSession = null;
      }
    });

    ws.on('close', () => {
      this.senders.delete(socketId);

      if (senderEntry.targetClientId) {
        const wr = this.webReceivers.get(senderEntry.targetClientId);
        if (wr && wr.activeSenderId === socketId) {
          if (wr.ws.readyState === WebSocket.OPEN) {
            this.sendJson(wr.ws, {
              type: 'cast-stop',
              sessionId: wr.activeSessionId || '',
              reason: 'Sender disconnected',
            });
          }
          wr.status = 'idle';
          wr.activeSenderId = null;
          wr.activeSessionId = null;
          this.emit('web-receivers-updated', this.getWebReceiverPeers());
        }
        return;
      }

      if (this.activeLocalSession?.senderSocketId === socketId) {
        const sessionId = this.activeLocalSession.sessionId;
        this.activeLocalSession = null;
        this.emit('receiver-signaling', {
          type: 'cast-stop',
          sessionId,
          reason: 'Sender disconnected',
        } satisfies SignalingMessage);
      }
    });
  }

  public sendToLocalSender(msg: SignalingMessage): void {
    if (!this.activeLocalSession) return;
    if (msg.sessionId !== this.activeLocalSession.sessionId) return;

    const sender = this.senders.get(this.activeLocalSession.senderSocketId);
    if (sender && sender.ws.readyState === WebSocket.OPEN) {
      this.sendJson(sender.ws, msg);
    }

    if (msg.type === 'cast-stop' || msg.type === 'cast-rejected') {
      this.activeLocalSession = null;
    }
  }

  public disconnectActiveLocalReceiver(reason = 'Receiver disconnected'): void {
    if (!this.activeLocalSession) return;
    const { sessionId, senderSocketId } = this.activeLocalSession;
    const sender = this.senders.get(senderSocketId);
    if (sender && sender.ws.readyState === WebSocket.OPEN) {
      this.sendJson(sender.ws, {
        type: 'cast-stop',
        sessionId,
        reason,
      });
    }
    this.activeLocalSession = null;
    this.emit('receiver-signaling', {
      type: 'cast-stop',
      sessionId,
      reason,
    } satisfies SignalingMessage);
  }

  private sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
