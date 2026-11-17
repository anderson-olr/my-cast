export interface ProbedMediaMetadata {
  duration: number;
  width: number;
  height: number;
  thumbnailDataUrl: string | null;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${mins}:${pad(secs)}`;
}

export function probeMediaUrl(mediaUrl: string): Promise<ProbedMediaMetadata> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let finished = false;
    let duration = 0;
    let width = 0;
    let height = 0;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // ignore
      }
    };

    const finish = (thumbnailDataUrl: string | null) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      cleanup();
      resolve({
        duration: Number.isFinite(duration) ? duration : 0,
        width,
        height,
        thumbnailDataUrl,
      });
    };

    const timer = window.setTimeout(() => {
      finish(null);
    }, 6000);

    video.onerror = () => {
      finish(null);
    };

    video.onloadedmetadata = () => {
      duration = Number.isFinite(video.duration) ? video.duration : 0;
      width = video.videoWidth || 0;
      height = video.videoHeight || 0;

      if (width <= 0 || height <= 0) {
        finish(null);
        return;
      }

      const seekTarget =
        duration > 0.2 ? Math.min(2, Math.max(0.1, duration * 0.1)) : 0;

      video.onseeked = () => {
        try {
          const targetW = 320;
          const targetH = 180;
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            finish(null);
            return;
          }
          ctx.fillStyle = '#04070e';
          ctx.fillRect(0, 0, targetW, targetH);

          const scale = Math.min(targetW / width, targetH / height);
          const drawW = Math.round(width * scale);
          const drawH = Math.round(height * scale);
          const offsetX = Math.round((targetW - drawW) / 2);
          const offsetY = Math.round((targetH - drawH) / 2);
          ctx.drawImage(video, offsetX, offsetY, drawW, drawH);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          finish(dataUrl);
        } catch {
          finish(null);
        }
      };

      try {
        video.currentTime = seekTarget;
      } catch {
        finish(null);
      }
    };

    video.src = mediaUrl;
  });
}
