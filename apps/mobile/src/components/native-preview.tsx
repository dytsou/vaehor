import { useVideoPlayer, VideoView } from "expo-video";
import { PdfView } from "@kishannareshpal/expo-pdf";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativePreviewKind } from "../lib/preview";
import { createAsyncRequestEpoch } from "../lib/async-request-epoch";
import { useMobileAudioPlayback } from "../lib/audio-playback";
import { formatMediaTime } from "../lib/mobile-formatters";
import {
  clearVideoProgress,
  getVideoProgress,
  saveVideoProgress,
} from "../lib/video-progress";
import { ContainerPreview } from "./container-preview";
import {
  findSubtitleCue,
  parseSubtitleCues,
  subtitleFileLabel,
  type SubtitleCue,
  type SubtitleFile,
} from "../lib/subtitles";

type NativePreviewProps = Readonly<{
  uri: string;
  kind: NativePreviewKind;
  text?: string | null;
  title?: string;
  resumeKey?: string;
  subtitleFiles?: SubtitleFile[];
  onLoadSubtitle?: (file: SubtitleFile) => Promise<string>;
}>;

export function NativePreview({
  uri,
  kind,
  text,
  title,
  resumeKey,
  subtitleFiles,
  onLoadSubtitle,
}: NativePreviewProps) {
  if (kind === "image") return <ImagePreview uri={uri} />;
  if (kind === "video") {
    return (
      <VideoPreview
        key={resumeKey ?? uri}
        onLoadSubtitle={onLoadSubtitle}
        resumeKey={resumeKey}
        subtitleFiles={subtitleFiles ?? []}
        uri={uri}
      />
    );
  }
  if (kind === "audio")
    return <AudioPreview title={title ?? "Audio preview"} uri={uri} />;
  if (kind === "text") return <TextPreview text={text} />;
  if (kind === "pdf")
    return <PdfView fitMode="width" style={styles.pdf} uri={uri} />;
  if (kind === "archive" || kind === "office" || kind === "epub") {
    return (
      <ContainerPreview kind={kind} title={title ?? "Document"} uri={uri} />
    );
  }

  return (
    <View style={styles.unsupported}>
      <Text style={styles.unsupportedTitle}>
        Native preview is unavailable for this format.
      </Text>
      <Text style={styles.unsupportedText}>
        You can still use the file download and save controls above.
      </Text>
    </View>
  );
}

function ImagePreview({ uri }: Readonly<{ uri: string }>) {
  return (
    <Image
      alt="File preview"
      accessibilityLabel="File preview"
      resizeMode="contain"
      source={{ uri }}
      style={styles.image}
    />
  );
}

function VideoPreview({
  uri,
  resumeKey,
  subtitleFiles,
  onLoadSubtitle,
}: Readonly<{
  uri: string;
  resumeKey?: string;
  subtitleFiles: SubtitleFile[];
  onLoadSubtitle?: (file: SubtitleFile) => Promise<string>;
}>) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 2;
  });
  const [resumePosition, setResumePosition] = useState(0);
  const [resumeReady, setResumeReady] = useState(false);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState(
    player.availableSubtitleTracks,
  );
  const [selectedTrack, setSelectedTrack] = useState(player.subtitleTrack);
  const [externalSubtitleId, setExternalSubtitleId] = useState<string | null>(
    null,
  );
  const [subtitleLoadingId, setSubtitleLoadingId] = useState<string | null>(
    null,
  );
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const subtitleCuesRef = useRef<SubtitleCue[]>([]);
  const subtitleRequestEpochRef = useRef(createAsyncRequestEpoch());
  const lastSavedSecondRef = useRef(0);

  useEffect(() => () => subtitleRequestEpochRef.current.invalidate(), []);

  useEffect(() => {
    let active = true;
    setResumeReady(false);
    setResumePosition(0);
    setShowResumePrompt(false);
    if (!resumeKey) {
      setResumeReady(true);
      return () => {
        active = false;
      };
    }

    void getVideoProgress(AsyncStorage, resumeKey)
      .then((seconds) => {
        if (!active) return;
        setResumePosition(seconds);
        setShowResumePrompt(seconds >= 10);
        setResumeReady(true);
      })
      .catch(() => {
        if (active) setResumeReady(true);
      });

    return () => {
      active = false;
    };
  }, [resumeKey]);

  useEffect(() => {
    const sourceSubscription = player.addListener("sourceLoad", (event) => {
      setSubtitleTracks(event.availableSubtitleTracks);
      const activeTrack = player.subtitleTrack;
      setSelectedTrack(
        activeTrack
          ? (event.availableSubtitleTracks.find(
              (track) => track.id === activeTrack.id,
            ) ?? activeTrack)
          : null,
      );
    });
    const trackSubscription = player.addListener(
      "subtitleTrackChange",
      (event) => {
        setSelectedTrack(event.subtitleTrack);
      },
    );
    const timeSubscription = player.addListener(
      "timeUpdate",
      ({ currentTime: time }) => {
        if (!Number.isFinite(time)) return;
        setCaptionAtTime(time);
        if (resumeKey && time >= lastSavedSecondRef.current + 5) {
          lastSavedSecondRef.current = Math.floor(time);
          void saveVideoProgress(AsyncStorage, resumeKey, time);
        }
      },
    );
    const endSubscription = player.addListener("playToEnd", () => {
      if (resumeKey) void clearVideoProgress(AsyncStorage, resumeKey);
      setResumePosition(0);
      setShowResumePrompt(false);
      lastSavedSecondRef.current = 0;
    });

    return () => {
      sourceSubscription.remove();
      trackSubscription.remove();
      timeSubscription.remove();
      endSubscription.remove();
      if (resumeKey && player.currentTime >= 1) {
        void saveVideoProgress(AsyncStorage, resumeKey, player.currentTime);
      }
    };
  }, [player, resumeKey]);

  function setCaptionAtTime(time: number) {
    setCaption(findSubtitleCue(subtitleCuesRef.current, time)?.text ?? "");
  }

  const [caption, setCaption] = useState("");

  const selectEmbeddedTrack = (
    track: (typeof subtitleTracks)[number] | null,
  ) => {
    subtitleRequestEpochRef.current.invalidate();
    setSubtitleLoadingId(null);
    player.subtitleTrack = track;
    setSelectedTrack(track);
    setExternalSubtitleId(null);
    subtitleCuesRef.current = [];
    setCaption("");
    setSubtitleError(null);
  };

  const selectExternalSubtitle = async (file: SubtitleFile) => {
    if (!onLoadSubtitle) return;
    const requestEpoch = subtitleRequestEpochRef.current.begin();
    setSubtitleLoadingId(file.id);
    setSubtitleError(null);
    try {
      const source = await onLoadSubtitle(file);
      if (!subtitleRequestEpochRef.current.isCurrent(requestEpoch)) return;
      const cues = parseSubtitleCues(source);
      if (cues.length === 0)
        throw new Error("No SRT or WebVTT captions were found in this file.");
      if (!subtitleRequestEpochRef.current.isCurrent(requestEpoch)) return;
      player.subtitleTrack = null;
      setSelectedTrack(null);
      setExternalSubtitleId(file.id);
      subtitleCuesRef.current = cues;
      setCaption(findSubtitleCue(cues, player.currentTime)?.text ?? "");
    } catch (cause) {
      if (!subtitleRequestEpochRef.current.isCurrent(requestEpoch)) return;
      setSubtitleError(
        cause instanceof Error
          ? cause.message
          : "Could not load this subtitle file.",
      );
    } finally {
      if (subtitleRequestEpochRef.current.isCurrent(requestEpoch)) {
        setSubtitleLoadingId(null);
      }
    }
  };

  const resumeVideo = () => {
    player.currentTime = resumePosition;
    lastSavedSecondRef.current = Math.floor(resumePosition);
    setShowResumePrompt(false);
    player.play();
  };

  const restartVideo = () => {
    player.currentTime = 0;
    if (resumeKey) void clearVideoProgress(AsyncStorage, resumeKey);
    lastSavedSecondRef.current = 0;
    setResumePosition(0);
    setShowResumePrompt(false);
    player.play();
  };

  return (
    <View style={styles.videoContainer}>
      <View style={styles.videoFrame}>
        <VideoView
          contentFit="contain"
          nativeControls={resumeReady && !showResumePrompt}
          player={player}
          style={styles.video}
        />
        {caption ? (
          <View pointerEvents="none" style={styles.subtitleOverlay}>
            <Text style={styles.subtitleText}>{caption}</Text>
          </View>
        ) : null}
        {!resumeReady ? (
          <View style={styles.videoStatusOverlay}>
            <ActivityIndicator color="#ffffff" />
            <Text style={styles.videoStatusText}>
              Loading playback position…
            </Text>
          </View>
        ) : null}
        {showResumePrompt ? (
          <View style={styles.videoStatusOverlay}>
            <View style={styles.resumeCard}>
              <Text style={styles.resumeTitle}>Continue watching?</Text>
              <Text style={styles.resumeText}>
                Saved at {formatMediaTime(resumePosition)}
              </Text>
              <View style={styles.resumeActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={restartVideo}
                  style={styles.resumeSecondaryButton}
                >
                  <Text style={styles.resumeSecondaryText}>Start over</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={resumeVideo}
                  style={styles.resumePrimaryButton}
                >
                  <Text style={styles.resumePrimaryText}>Resume</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
      {subtitleTracks.length > 0 || subtitleFiles.length > 0 ? (
        <View style={styles.subtitlePicker}>
          <Text style={styles.subtitleLabel}>Subtitles</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.subtitleOptions}>
              <SubtitleOption
                active={!selectedTrack && externalSubtitleId === null}
                label="Off"
                onPress={() => selectEmbeddedTrack(null)}
              />
              {subtitleTracks.map((track, index) => (
                <SubtitleOption
                  active={selectedTrack === track}
                  key={`${track.id ?? track.language ?? track.label}-${index}`}
                  label={track.label || track.language || `Track ${index + 1}`}
                  onPress={() => selectEmbeddedTrack(track)}
                />
              ))}
              {subtitleFiles.map((file) => (
                <SubtitleOption
                  active={externalSubtitleId === file.id}
                  disabled={subtitleLoadingId !== null}
                  key={file.id}
                  label={
                    subtitleLoadingId === file.id
                      ? "Loading…"
                      : subtitleFileLabel(file.name)
                  }
                  onPress={() => void selectExternalSubtitle(file)}
                />
              ))}
            </View>
          </ScrollView>
          {subtitleError ? (
            <Text style={styles.subtitleError}>{subtitleError}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SubtitleOption({
  label,
  active,
  disabled,
  onPress,
}: Readonly<{
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.subtitleOption, active && styles.subtitleOptionActive]}
    >
      <Text
        style={[
          styles.subtitleOptionText,
          active && styles.subtitleOptionTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AudioPreview({
  uri,
  title,
}: Readonly<{ uri: string; title: string }>) {
  const { activeTrack, currentTime, duration, isPlaying, play, toggle } =
    useMobileAudioPlayback();
  const isCurrentTrack = activeTrack?.uri === uri;
  const displayedDuration = isCurrentTrack ? duration : 0;
  const displayedCurrentTime = isCurrentTrack ? currentTime : 0;
  const playing = isCurrentTrack && isPlaying;

  return (
    <View style={styles.audio}>
      <Text style={styles.audioTitle}>Audio preview</Text>
      <Text style={styles.audioTime}>
        {formatMediaTime(displayedCurrentTime)} /{" "}
        {formatMediaTime(displayedDuration)}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => (isCurrentTrack ? toggle() : play(uri, title))}
        style={styles.openButton}
      >
        <Text style={styles.openButtonText}>{playing ? "Pause" : "Play"}</Text>
      </Pressable>
    </View>
  );
}

function TextPreview({ text }: Readonly<{ text?: string | null }>) {
  const [content, setContent] = useState(text ?? "Loading preview…");

  useEffect(() => {
    setContent(text ?? "Loading preview…");
  }, [text]);

  return (
    <ScrollView style={styles.textContainer} nestedScrollEnabled>
      <Text selectable style={styles.textPreview}>
        {content}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: "#0b1517",
    borderRadius: 10,
    height: 240,
    width: "100%",
  },
  video: {
    backgroundColor: "#0b1517",
    borderRadius: 10,
    height: 240,
    width: "100%",
  },
  videoContainer: {
    gap: 8,
  },
  videoFrame: {
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  videoStatusOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.68)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: 16,
    position: "absolute",
    right: 0,
    top: 0,
  },
  videoStatusText: {
    color: "#ffffff",
    marginTop: 8,
  },
  resumeCard: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    gap: 8,
    maxWidth: 300,
    padding: 16,
    width: "100%",
  },
  resumeTitle: {
    color: "#15363a",
    fontSize: 16,
    fontWeight: "700",
  },
  resumeText: {
    color: "#45666a",
  },
  resumeActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  resumePrimaryButton: {
    alignItems: "center",
    backgroundColor: "#1f6f78",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resumePrimaryText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  resumeSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#e8f1f2",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resumeSecondaryText: {
    color: "#15363a",
    fontWeight: "700",
  },
  subtitleOverlay: {
    alignSelf: "center",
    bottom: 22,
    maxWidth: "90%",
    position: "absolute",
  },
  subtitleText: {
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    borderRadius: 4,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  subtitlePicker: {
    gap: 6,
  },
  subtitleLabel: {
    color: "#45666a",
    fontSize: 12,
    fontWeight: "700",
  },
  subtitleOptions: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 8,
  },
  subtitleOption: {
    backgroundColor: "#e8f1f2",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  subtitleOptionActive: {
    backgroundColor: "#1f6f78",
  },
  subtitleOptionText: {
    color: "#15363a",
    fontSize: 12,
  },
  subtitleOptionTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  subtitleError: {
    color: "#b42318",
    fontSize: 12,
  },
  pdf: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    height: 400,
    width: "100%",
  },
  audio: {
    alignItems: "center",
    backgroundColor: "#e8f1f2",
    borderRadius: 10,
    gap: 8,
    padding: 18,
  },
  audioTitle: {
    color: "#15363a",
    fontSize: 16,
    fontWeight: "700",
  },
  audioTime: {
    color: "#45666a",
    fontVariant: ["tabular-nums"],
  },
  textContainer: {
    backgroundColor: "#101719",
    borderRadius: 10,
    maxHeight: 300,
    padding: 12,
  },
  textPreview: {
    color: "#d8e8e8",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  unsupported: {
    backgroundColor: "#eef2f3",
    borderRadius: 10,
    gap: 8,
    padding: 16,
  },
  unsupportedTitle: {
    color: "#15363a",
    fontWeight: "700",
  },
  unsupportedText: {
    color: "#45666a",
  },
  openButton: {
    alignItems: "center",
    backgroundColor: "#1f6f78",
    borderRadius: 8,
    minWidth: 100,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  openButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
