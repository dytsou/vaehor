export type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export type SubtitleFile = {
  id: string;
  name: string;
  isFolder?: boolean;
};

const SUPPORTED_EXTENSIONS = new Set(["srt", "vtt"]);

export function findExternalSubtitleFiles<T extends SubtitleFile>(
  video: SubtitleFile,
  files: readonly T[],
): T[] {
  const baseName = fileStem(video.name).toLowerCase();
  if (!baseName) return [];

  return files.filter((file) => {
    const extension = fileExtension(file.name);
    const subtitleStem = fileStem(file.name).toLowerCase();
    const hasMatchingStem =
      subtitleStem === baseName ||
      [".", "_", "-", " "].some((separator) =>
        subtitleStem.startsWith(`${baseName}${separator}`),
      );
    return (
      file.id !== video.id &&
      !file.isFolder &&
      SUPPORTED_EXTENSIONS.has(extension) &&
      hasMatchingStem
    );
  });
}

export function parseSubtitleCues(source: string): SubtitleCue[] {
  const lines = source
    .replace(/^\uFEFF/, "")
    .replaceAll("\r", "")
    .split("\n");
  const cues: SubtitleCue[] = [];

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const timing = /^\s*(\S+)\s*-->\s*(\S+)/.exec(lines[lineIndex]!);
    lineIndex += 1;
    if (!timing) continue;

    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    if (start === null || end === null || end <= start) continue;

    const body: string[] = [];
    while (lineIndex < lines.length && lines[lineIndex]!.trim() !== "") {
      body.push(lines[lineIndex]!);
      lineIndex += 1;
    }
    const text = cleanCueText(body.join("\n"));
    if (text) cues.push({ start, end, text });
  }

  return cues.sort((left, right) => left.start - right.start);
}

export function findSubtitleCue(
  cues: readonly SubtitleCue[],
  currentTime: number,
): SubtitleCue | null {
  if (!Number.isFinite(currentTime) || currentTime < 0) return null;

  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = cues[middle];
    if (currentTime < cue.start) high = middle - 1;
    else if (currentTime >= cue.end) low = middle + 1;
    else return cue;
  }
  return null;
}

export function subtitleFileLabel(name: string): string {
  return name.replace(/\.(srt|vtt)$/i, "").slice(-48) || "Subtitles";
}

function parseTimestamp(value: string): number | null {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  const minutes = Number(parts.at(-2));
  const secondsMatch = /^(\d{2})(?:[,.](\d{1,3}))?$/.exec(parts.at(-1)!);
  if (!secondsMatch) return null;
  const seconds = Number(secondsMatch[1]);
  const milliseconds = Number((secondsMatch[2] ?? "").padEnd(3, "0") || 0);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    minutes > 59 ||
    seconds > 59
  )
    return null;

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function cleanCueText(value: string): string {
  return value
    .replace(/<\/?(?:i|b|u|font|c(?:\.[\w-]+)?)(?=[\s>])[^<>]*>/gi, "")
    .replace(/&(amp|lt|gt|quot|#39);/gi, (entity) => {
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&#39;":
          return "'";
        default:
          return entity;
      }
    })
    .trim();
}

function fileExtension(name: string): string {
  return name.substring(name.lastIndexOf(".") + 1).toLowerCase();
}

function fileStem(name: string): string {
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
}
