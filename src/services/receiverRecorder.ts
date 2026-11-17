import { SavedFileResult } from '../types/mycast';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickSupportedRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'video/webm';
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return 'video/webm';
}

export class ReceiverRecorder {
  private recorder: MediaRecorder | null = null;
  private recordingId: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private finalizePromise: Promise<SavedFileResult | null> | null = null;
  private manualStop = false;

  public isRecording(): boolean {
    return Boolean(this.recorder && this.recorder.state !== 'inactive');
  }

  public async start(
    stream: MediaStream,
    senderName?: string,
    onAutoStop?: (result: SavedFileResult) => void
  ): Promise<{ recordingId: string; filePath: string; fileName: string }> {
    if (this.recorder || this.recordingId) {
      throw new Error('Recording is already in progress');
    }

    const started = await window.mycast.startRecordingFile(senderName);
    const { recordingId, filePath, fileName } = started;

    this.recordingId = recordingId;
    this.writeQueue = Promise.resolve();
    this.manualStop = false;

    const mimeType = pickSupportedRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 12_000_000,
      });
    } catch (err) {
      this.recordingId = null;
      await window.mycast.finishRecordingFile(recordingId).catch(() => {});
      throw err;
    }

    this.recorder = recorder;

    let resolveFinalize!: (result: SavedFileResult | null) => void;
    let rejectFinalize!: (err: unknown) => void;
    this.finalizePromise = new Promise<SavedFileResult | null>((resolve, reject) => {
      resolveFinalize = resolve;
      rejectFinalize = reject;
    });

    recorder.ondataavailable = (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return;
      const blob = event.data;
      this.writeQueue = this.writeQueue.then(async () => {
        const buffer = await blob.arrayBuffer();
        await window.mycast.appendRecordingChunk(recordingId, new Uint8Array(buffer));
      });
    };

    recorder.onstop = async () => {
      try {
        await this.writeQueue;
        const result = await window.mycast.finishRecordingFile(recordingId);
        this.cleanupRefs();
        if (!this.manualStop && onAutoStop) {
          onAutoStop(result);
        }
        resolveFinalize(result);
      } catch (err) {
        this.cleanupRefs();
        rejectFinalize(err);
      }
    };

    recorder.onerror = () => {
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
    };

    recorder.start(1000);
    return { recordingId, filePath, fileName };
  }

  public async stop(): Promise<SavedFileResult | null> {
    if (!this.recorder) {
      return this.finalizePromise ? await this.finalizePromise : null;
    }

    this.manualStop = true;
    const pendingFinalize = this.finalizePromise;
    if (this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    return pendingFinalize ? await pendingFinalize : null;
  }

  private cleanupRefs(): void {
    this.recorder = null;
    this.recordingId = null;
    this.finalizePromise = null;
  }
}

export async function captureVideoScreenshot(
  videoEl: HTMLVideoElement,
  senderName?: string
): Promise<SavedFileResult> {
  if (!videoEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) {
    throw new Error('Video frame is not ready for screenshot');
  }

  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context');
  }

  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  return window.mycast.saveScreenshot(dataUrl, senderName);
}
