import { describe, expect, it } from "vitest";
import {
  findSubtitleCue,
  findExternalSubtitleFiles,
  parseSubtitleCues,
  subtitleFileLabel,
} from "../src/lib/subtitles";
import {
  clearVideoProgress,
  createVideoProgressId,
  getVideoProgress,
  saveVideoProgress,
} from "../src/lib/video-progress";

function createMemoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("native media support", () => {
  it("finds matching SRT and WebVTT siblings without matching folders", () => {
    const video = { id: "video", name: "film.mkv" };
    const files = [
      { id: "en", name: "film.en.srt" },
      { id: "zh", name: "film.zh-Hant.vtt" },
      { id: "wrong-prefix", name: "filmography.srt" },
      { id: "archive", name: "film.srt.backup" },
      { id: "other", name: "another.srt" },
      { id: "folder", name: "film.subtitles.srt", isFolder: true },
    ];

    expect(
      findExternalSubtitleFiles(video, files).map((file) => file.id),
    ).toEqual(["en", "zh"]);
    expect(subtitleFileLabel("film.zh-Hant.vtt")).toBe("film.zh-Hant");
  });

  it("parses WebVTT and SRT cues as plain text and selects the active cue", () => {
    const cues = parseSubtitleCues(
      "\uFEFFWEBVTT\n\n00:00:01.000 --> 00:00:02.500 line:90%\n<c.white>Hello &amp; welcome</c>\n\n1\n00:00:03,000 --> 00:00:04,000\n<i>Next line</i>",
    );

    expect(cues).toEqual([
      { start: 1, end: 2.5, text: "Hello & welcome" },
      { start: 3, end: 4, text: "Next line" },
    ]);
    expect(findSubtitleCue(cues, 1.5)?.text).toBe("Hello & welcome");
    expect(findSubtitleCue(cues, 2.5)).toBeNull();
  });

  it("keeps saved progress isolated by server and clears it when playback restarts", async () => {
    const store = createMemoryStore();
    const videoId = createVideoProgressId("https://a.example/", "file-1");
    const otherServerId = createVideoProgressId("https://b.example", "file-1");

    await saveVideoProgress(store, videoId, 19.8);
    expect(await getVideoProgress(store, videoId)).toBe(19);
    expect(await getVideoProgress(store, otherServerId)).toBe(0);

    await clearVideoProgress(store, videoId);
    expect(await getVideoProgress(store, videoId)).toBe(0);
  });
});
