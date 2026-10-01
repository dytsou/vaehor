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

  it("uses a native PDF viewer and classifies container formats for in-app preview", () => {
    expect(getNativePreviewKind("application/pdf", "report.pdf")).toBe("pdf");
    expect(getNativePreviewKind(undefined, "report.pdf")).toBe("pdf");
    expect(
      getNativePreviewKind("application/vnd.ms-excel", "report.xlsx"),
    ).toBe("office");
    expect(
      getNativePreviewKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "report.docx",
      ),
    ).toBe("office");
    expect(getNativePreviewKind("application/epub+zip", "book.epub")).toBe(
      "epub",
    );
    expect(getNativePreviewKind("application/zip", "backup.zip")).toBe(
      "archive",
    );
    expect(getNativePreviewKind("application/msword", "legacy.doc")).toBe(
      "unsupported",
    );
  });
});
