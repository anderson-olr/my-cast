export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

function parseTimestamp(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = Number.parseInt(parts[0], 10);
    minutes = Number.parseInt(parts[1], 10);
    seconds = Number.parseFloat(parts[2]);
  } else {
    minutes = Number.parseInt(parts[0], 10);
    seconds = Number.parseFloat(parts[1]);
  }

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    seconds < 0
  ) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function cleanCueText(raw: string): string {
  return raw
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

export function parseSubtitles(rawText: string): SubtitleCue[] {
  if (!rawText) return [];

  const normalized = rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);

    if (lines.length === 0) continue;

    const firstTrimmed = lines[0].trim();
    if (
      firstTrimmed.startsWith('WEBVTT') ||
      firstTrimmed.startsWith('NOTE') ||
      firstTrimmed === 'STYLE' ||
      firstTrimmed.startsWith('STYLE ') ||
      firstTrimmed === 'REGION' ||
      firstTrimmed.startsWith('REGION ')
    ) {
      continue;
    }

    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const timingLine = lines[timingIndex];
    const arrowMatch = /^([^\s]+)\s*-->\s*([^\s]+)/.exec(timingLine.trim());
    if (!arrowMatch) continue;

    const startSec = parseTimestamp(arrowMatch[1]);
    const endSec = parseTimestamp(arrowMatch[2]);
    if (startSec === null || endSec === null || endSec <= startSec) continue;

    const textLines = lines.slice(timingIndex + 1);
    const text = cleanCueText(textLines.join('\n'));
    if (!text) continue;

    cues.push({ startSec, endSec, text });
  }

  cues.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  return cues;
}

export function findActiveSubtitleCue(
  cues: SubtitleCue[],
  currentTimeSec: number
): string | null {
  if (!cues.length || !Number.isFinite(currentTimeSec)) return null;

  const activeTexts: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.startSec > currentTimeSec) break;
    if (currentTimeSec >= cue.startSec && currentTimeSec <= cue.endSec) {
      activeTexts.push(cue.text);
    }
  }

  return activeTexts.length > 0 ? activeTexts.join('\n') : null;
}
