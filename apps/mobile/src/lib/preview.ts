export type NativePreviewKind =
  "image" | "video" | "audio" | "text" | "pdf" | "unsupported";

const TEXT_EXTENSIONS = new Set([
  "c",
  "cc",
  "conf",
  "cpp",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mjs",
  "py",
  "rb",
  "rs",
  "srt",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vtt",
  "xml",
  "yaml",
  "yml",
]);

function extensionOf(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot < 0 ? "" : name.slice(lastDot + 1).toLowerCase();
}

export function getNativePreviewKind(
  mimeType: string | null | undefined,
  name = "",
): NativePreviewKind {
  const mime = mimeType?.toLowerCase().split(";", 1)[0] ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  if (mime === "application/pdf" || extensionOf(name) === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(extensionOf(name))) return "text";
  return "unsupported";
}
