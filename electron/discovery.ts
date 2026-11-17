import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { DiscoveredPeer, DiscoveryBeacon, ReceiverStatus } from './types';

export const DISCOVERY_PORT = 48899;
export const MULTICAST_ADDR = '239.255.48.90';
const BROADCAST_INTERVAL_MS = 2500;
const PEER_TTL_MS = 8500;

export interface LanInterface {
  name: string;
  ip: string;
  netmask: string;
  broadcast: string;
  isVirtual: boolean;
}

function ipToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) | (parseInt(octet, 10) & 0xff)) >>> 0, 0);
}

function intToIp(int: number): string {
  return [
    (int >>> 24) & 0xff,
    (int >>> 16) & 0xff,
    (int >>> 8) & 0xff,
    int & 0xff,
  ].join('.');
}

function computeBroadcast(ip: string, netmask: string): string {
  const ipInt = ipToInt(ip);
  const maskInt = ipToInt(netmask);
  const bcastInt = (ipInt | (~maskInt >>> 0)) >>> 0;
  return intToIp(bcastInt);
}

const VIRTUAL_ADAPTER_REGEX = /(vethernet|hyper-v|wsl|virtualbox|vbox|vmware|docker|tailscale|zerotier|loopback|nordlynx|wireguard)/i;

export function getLanInterfaces(): LanInterface[] {
  const interfaces = os.networkInterfaces();
  const result: LanInterface[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue; // Skip APIPA

      result.push({
        name,
        ip: addr.address,
        netmask: addr.netmask,
        broadcast: computeBroadcast(addr.address, addr.netmask),
        isVirtual: VIRTUAL_ADAPTER_REGEX.test(name),
      });
    }
  }

  // Prefer non-virtual interfaces first, and standard private LAN subnets (192.168 / 10 / 172.16-31)
  result.sort((a, b) => {
    if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1;
    const score = (ip: string) =>
      ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : 1;
    return score(b.ip) - score(a.ip);
  });

  return result;
}

export function getPrimaryLanIp(): string {
  const list = getLanInterfaces();
  const nonVirtual = list.find((iface) => !iface.isVirtual);
  if (nonVirtual) return nonVirtual.ip;
  if (list.length > 0) return list[0].ip;
  return '127.0.0.1';
}

export interface DiscoveryServiceOptions {
  selfId: string;
  getBeaconInfo: () => {
    name: string;
    port: number;
    pinRequired: boolean;
    status: ReceiverStatus;
  };
}

export class DiscoveryService extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private peers = new Map<string, DiscoveredPeer>();
  private manualPeers = new Map<string, DiscoveredPeer>();
  private broadcastTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private readonly selfId: string;
  private readonly getBeaconInfo: DiscoveryServiceOptions['getBeaconInfo'];
  private started = false;

  constructor(options: DiscoveryServiceOptions) {
    super();
    this.selfId = options.selfId;
    this.getBeaconInfo = options.getBeaconInfo;
  }

  public start(): Promise<void> {
    if (this.started) return Promise.resolve();

    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = socket;

      socket.on('error', (err) => {
        console.error('[Discovery] UDP socket error:', err.message);
      });

      socket.on('message', (msg, rinfo) => {
        this.handleIncomingPacket(msg, rinfo.address);
      });

      socket.bind(DISCOVERY_PORT, () => {
        this.started = true;
        try {
          socket.setBroadcast(true);
        } catch (err) {
          console.warn('[Discovery] Failed to setBroadcast:', err);
        }

        try {
          socket.setMulticastTTL(4);
          socket.setMulticastLoopback(true);
        } catch {
          // Non-fatal
        }

        const ifaces = getLanInterfaces();
        const nonVirtual = ifaces.filter((i) => !i.isVirtual);
        const targets = nonVirtual.length > 0 ? nonVirtual : ifaces;

        for (const iface of targets) {
          try {
            socket.addMembership(MULTICAST_ADDR, iface.ip);
          } catch {
            // Try fallback default membership below
          }
        }
        try {
          socket.addMembership(MULTICAST_ADDR);
        } catch {
          // Non-fatal if multicast unavailable on adapter
        }

        // Send an immediate beacon on startup
        this.sendBeacon();

        this.broadcastTimer = setInterval(() => {
          this.sendBeacon();
        }, BROADCAST_INTERVAL_MS);

        this.pruneTimer = setInterval(() => {
          this.pruneStalePeers();
        }, 2000);

        resolve();
      });
    });
  }

  public stop(): void {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.started = false;
  }

  public sendBeacon(): void {
    if (!this.socket || !this.started) return;

    const info = this.getBeaconInfo();
    if (!info.port) return;

    const primaryIp = getPrimaryLanIp();
    const beacon: DiscoveryBeacon = {
      type: 'MYCAST_BEACON',
      id: this.selfId,
      name: info.name,
      hostname: os.hostname(),
      ip: primaryIp,
      port: info.port,
      pinRequired: info.pinRequired,
      status: info.status,
      timestamp: Date.now(),
    };

    const payload = Buffer.from(JSON.stringify(beacon));
    const addresses = new Set<string>(['255.255.255.255', MULTICAST_ADDR]);

    for (const iface of getLanInterfaces()) {
      if (!iface.isVirtual) {
        addresses.add(iface.broadcast);
      }
    }

    for (const addr of addresses) {
      this.socket.send(payload, 0, payload.length, DISCOVERY_PORT, addr, (err) => {
        if (err && process.env.DEBUG_DISCOVERY) {
          console.debug(`[Discovery] Send error to ${addr}:`, err.message);
        }
      });
    }
  }

  private handleIncomingPacket(msg: Buffer, remoteAddress: string): void {
    try {
      const parsed = JSON.parse(msg.toString('utf8')) as Partial<DiscoveryBeacon>;
      if (parsed.type !== 'MYCAST_BEACON' || !parsed.id || !parsed.port) return;
      if (parsed.id === this.selfId) return;

      const peerIp =
        remoteAddress && remoteAddress !== '0.0.0.0' ? remoteAddress : parsed.ip || '127.0.0.1';

      const existing = this.peers.get(parsed.id);
      const updated: DiscoveredPeer = {
        id: parsed.id,
        name: parsed.name || parsed.hostname || `PC (${peerIp})`,
        hostname: parsed.hostname || '',
        ip: peerIp,
        port: parsed.port,
        pinRequired: Boolean(parsed.pinRequired),
        status: parsed.status || 'idle',
        lastSeen: Date.now(),
        isWebReceiver: false,
      };

      const changed =
        !existing ||
        existing.name !== updated.name ||
        existing.ip !== updated.ip ||
        existing.port !== updated.port ||
        existing.pinRequired !== updated.pinRequired ||
        existing.status !== updated.status;

      this.peers.set(parsed.id, updated);
      if (changed) {
        this.emitPeers();
      }
    } catch {
      // Ignore malformed UDP packets
    }
  }

  private pruneStalePeers(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > PEER_TTL_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.emitPeers();
    }
  }

  public getPeers(): DiscoveredPeer[] {
    const merged = new Map<string, DiscoveredPeer>();
    for (const peer of this.manualPeers.values()) {
      merged.set(peer.id, peer);
    }
    for (const peer of this.peers.values()) {
      merged.set(peer.id, peer);
    }
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  public async probeManualPeer(hostOrIp: string, port = 48900): Promise<DiscoveredPeer> {
    const cleanHost = hostOrIp.trim().replace(/^https?:\/\//, '').split('/')[0];
    let targetIp = cleanHost;
    let targetPort = port;

    if (cleanHost.includes(':')) {
      const [h, p] = cleanHost.split(':');
      targetIp = h;
      const parsedPort = parseInt(p, 10);
      if (!Number.isNaN(parsedPort) && parsedPort > 0) {
        targetPort = parsedPort;
      }
    }

    const url = `http://${targetIp}:${targetPort}/api/info`;
    const data = await new Promise<{
      id: string;
      name: string;
      hostname?: string;
      ip?: string;
      port?: number;
      pinRequired?: boolean;
      status?: ReceiverStatus;
    }>((resolve, reject) => {
      const req = http.get(url, { timeout: 4000 }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Receiver returned HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Invalid JSON response from receiver'));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Connection timed out (${targetIp}:${targetPort})`));
      });
      req.on('error', (err) => {
        reject(new Error(`Could not reach ${targetIp}:${targetPort}: ${err.message}`));
      });
    });

    const peer: DiscoveredPeer = {
      id: data.id || `manual-${targetIp}:${targetPort}`,
      name: data.name || data.hostname || `PC (${targetIp})`,
      hostname: data.hostname || '',
      ip: targetIp,
      port: data.port || targetPort,
      pinRequired: Boolean(data.pinRequired),
      status: data.status || 'idle',
      lastSeen: Date.now(),
      isWebReceiver: false,
      isManual: true,
    };

    if (peer.id !== this.selfId) {
      this.manualPeers.set(peer.id, peer);
      this.emitPeers();
    }

    return peer;
  }

  public removeManualPeer(peerId: string): void {
    if (this.manualPeers.delete(peerId)) {
      this.emitPeers();
    }
  }

  private emitPeers(): void {
    this.emit('peers-updated', this.getPeers());
  }
}
