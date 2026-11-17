import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

export class LocalMediaServer {
  private server: http.Server | null = null;
  private boundPort = 0;
  private readonly token = crypto.randomBytes(24).toString('hex');
  private readonly filesById = new Map<string, string>();
  private readonly idByPath = new Map<string, string>();

  public async start(): Promise<number> {
    if (this.server && this.boundPort > 0) {
      return this.boundPort;
    }

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleRequest(req, res));

      const onError = (err: Error) => {
        server.close();
        reject(err);
      };

      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError);
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to resolve LocalMediaServer bound port'));
          return;
        }
        this.server = server;
        this.boundPort = addr.port;
        server.on('error', (err) => {
          console.error('[MediaServer] HTTP error:', err.message);
        });
        resolve(this.boundPort);
      });
    });
  }

  public stop(): void {
    this.filesById.clear();
    this.idByPath.clear();
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

  public registerFile(filePath: string): string {
    if (!this.server || this.boundPort <= 0) {
      throw new Error('LocalMediaServer has not been started');
    }

    const normalized = path.resolve(filePath);
    let id = this.idByPath.get(normalized);
    if (!id) {
      id = crypto.randomUUID();
      this.idByPath.set(normalized, id);
      this.filesById.set(id, normalized);
    }

    return `http://127.0.0.1:${this.boundPort}/media/${id}?token=${this.token}`;
  }

  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const match = reqUrl.pathname.match(/^\/media\/([^/]+)$/);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const token = reqUrl.searchParams.get('token');
    if (token !== this.token) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const mediaId = match[1];
    const filePath = this.filesById.get(mediaId);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Media not found');
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('File not found');
        return;
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('File unavailable');
      return;
    }

    const totalSize = stat.size;
    const contentType = getMimeType(filePath);
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const parsed = this.parseRangeHeader(rangeHeader, totalSize);
      if (!parsed) {
        res.writeHead(416, {
          'Content-Range': `bytes */${totalSize}`,
        });
        res.end();
        return;
      }

      const { start, end } = parsed;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      this.pipeFileStream(filePath, { start, end }, res);
      return;
    }

    res.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': totalSize,
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    this.pipeFileStream(filePath, undefined, res);
  }

  private parseRangeHeader(
    rangeHeader: string,
    totalSize: number
  ): { start: number; end: number } | null {
    if (totalSize === 0) return null;
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) return null;

    const startStr = match[1];
    const endStr = match[2];

    if (startStr === '' && endStr === '') return null;

    let start: number;
    let end: number;

    if (startStr === '') {
      const suffixLength = Number.parseInt(endStr, 10);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
      start = Math.max(0, totalSize - suffixLength);
      end = totalSize - 1;
    } else {
      start = Number.parseInt(startStr, 10);
      end = endStr === '' ? totalSize - 1 : Number.parseInt(endStr, 10);
    }

    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 0 || start >= totalSize) return null;
    end = Math.min(end, totalSize - 1);
    if (end < start) return null;

    return { start, end };
  }

  private pipeFileStream(
    filePath: string,
    opts: { start: number; end: number } | undefined,
    res: http.ServerResponse
  ): void {
    const stream = fs.createReadStream(filePath, opts);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.destroy();
    });
    res.on('close', () => {
      stream.destroy();
    });
    stream.pipe(res);
  }
}
