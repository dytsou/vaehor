import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMobilePreferences } from "./mobile-preferences";
import { formatMediaTime } from "./mobile-formatters";

type ActiveTrack = { uri: string; title: string };

type AudioPlaybackContextValue = {
  activeTrack: ActiveTrack | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  play: (uri: string, title: string) => void;
  toggle: () => void;
};

const AudioPlaybackContext = createContext<AudioPlaybackContextValue | null>(
  null,
);

export function MobileAudioPlaybackProvider({
  children,
}: {
  children: ReactNode;
}) {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const { theme } = useMobilePreferences();
  const [activeTrack, setActiveTrack] = useState<ActiveTrack | null>(null);

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch(() => undefined);

    return () => {
      player.pause();
      player.clearLockScreenControls();
    };
  }, [player]);

  const play = useCallback(
    (uri: string, title: string) => {
      const isSameTrack = activeTrack?.uri === uri;
      if (!isSameTrack) {
        player.replace(uri);
        setActiveTrack({ uri, title });
      }
      player.setActiveForLockScreen(true, {
        title,
        artist: "Vaehor",
      });
      if (
        isSameTrack &&
        status.currentTime >= status.duration &&
        status.duration > 0
      ) {
        void player.seekTo(0);
      }
      player.play();
    },
    [activeTrack?.uri, player, status.currentTime, status.duration],
  );

  const toggle = useCallback(() => {
    if (!activeTrack) return;
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.currentTime >= status.duration && status.duration > 0) {
      void player.seekTo(0);
    }
    player.play();
  }, [
    activeTrack,
    player,
    status.currentTime,
    status.duration,
    status.playing,
  ]);

  const close = useCallback(() => {
    player.pause();
    void player.seekTo(0);
    player.clearLockScreenControls();
    setActiveTrack(null);
  }, [player]);

  const value = useMemo<AudioPlaybackContextValue>(
    () => ({
      activeTrack,
      currentTime: Number.isFinite(status.currentTime) ? status.currentTime : 0,
      duration: Number.isFinite(status.duration) ? status.duration : 0,
      isPlaying: status.playing,
      play,
      toggle,
    }),
    [
      activeTrack,
      play,
      status.currentTime,
      status.duration,
      status.playing,
      toggle,
    ],
  );

  return (
    <AudioPlaybackContext.Provider value={value}>
      <View style={styles.container}>
        {children}
        {activeTrack ? (
          <View
            accessibilityLabel={`Audio player: ${activeTrack.title}`}
            style={[
              styles.miniPlayer,
              theme === "dark" ? styles.miniPlayerDark : styles.miniPlayerLight,
            ]}
          >
            <View style={styles.trackInfo}>
              <Text
                numberOfLines={1}
                style={theme === "dark" ? styles.titleDark : styles.titleLight}
              >
                {activeTrack.title}
              </Text>
              <Text
                style={theme === "dark" ? styles.timeDark : styles.timeLight}
              >
                {formatMediaTime(value.currentTime)} /{" "}
                {formatMediaTime(value.duration)}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={
                value.isPlaying ? "Pause audio" : "Play audio"
              }
              accessibilityRole="button"
              onPress={toggle}
              style={styles.control}
            >
              <Text style={styles.controlText}>
                {value.isPlaying ? "Pause" : "Play"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Close audio player"
              accessibilityRole="button"
              onPress={close}
              style={styles.closeControl}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </AudioPlaybackContext.Provider>
  );
}

export function useMobileAudioPlayback(): AudioPlaybackContextValue {
  const context = useContext(AudioPlaybackContext);
  if (!context)
    throw new Error("Audio playback must be used inside its provider.");
  return context;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  miniPlayer: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  miniPlayerLight: {
    backgroundColor: "#ffffff",
    borderTopColor: "#d3dfe1",
  },
  miniPlayerDark: {
    backgroundColor: "#1b2630",
    borderTopColor: "#3a4a58",
  },
  trackInfo: {
    flex: 1,
    gap: 2,
  },
  titleLight: {
    color: "#15363a",
    fontSize: 13,
    fontWeight: "700",
  },
  titleDark: {
    color: "#f0f5f6",
    fontSize: 13,
    fontWeight: "700",
  },
  timeLight: {
    color: "#45666a",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  timeDark: {
    color: "#afc0c6",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  control: {
    alignItems: "center",
    backgroundColor: "#1f6f78",
    borderRadius: 8,
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  controlText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  closeControl: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: 30,
  },
  closeText: {
    color: "#789096",
    fontSize: 24,
    lineHeight: 28,
  },
});
