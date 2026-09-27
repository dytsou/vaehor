import { describe, expect, it } from "vitest";
import { getNativePreviewKind } from "../src/lib/preview";

describe("native preview classification", () => {
  it("uses native media previews for common MIME types", () => {
    expect(getNativePreviewKind("image/jpeg", "photo.jpg")).toBe("image");
    expect(getNativePreviewKind("video/mp4", "clip.mp4")).toBe("video");
    expect(getNativePreviewKind("audio/mpeg", "song.mp3")).toBe("audio");
  });

  it("recognizes code and subtitle files as text", () => {
    expect(getNativePreviewKind(undefined, "main.tsx")).toBe("text");
    expect(
      getNativePreviewKind("application/octet-stream", "captions.vtt"),
    ).toBe("text");
  });

  it("uses the native PDF viewer and keeps other formats on the system open path", () => {
    expect(getNativePreviewKind("application/pdf", "report.pdf")).toBe("pdf");
    expect(getNativePreviewKind(undefined, "report.pdf")).toBe("pdf");
    expect(
      getNativePreviewKind("application/vnd.ms-excel", "report.xlsx"),
    ).toBe("unsupported");
  });
});
