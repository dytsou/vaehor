export type NativePreviewKind =
  | "image"
  | "video"
  | "audio"
  | "text"
  | "pdf"
  | "archive"
  | "office"
  | "epub"
  | "unsupported";

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

export function extensionOf(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot < 0 ? "" : name.slice(lastDot + 1).toLowerCase();
}

export function getNativePreviewKind(
  mimeType: string | null | undefined,
  name = "",
): NativePreviewKind {
  const mime = mimeType?.toLowerCase().split(";", 1)[0] ?? "";
  const extension = extensionOf(name);
  if (extension === "epub" || mime === "application/epub+zip") return "epub";
  if (["docx", "pptx", "xlsx"].includes(extension)) return "office";
  if (
    extension === "zip" ||
    mime === "application/zip" ||
    mime === "application/x-zip-compressed"
  ) {
    return "archive";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "unsupported";
}
