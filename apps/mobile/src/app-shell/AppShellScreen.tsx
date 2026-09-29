import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t, type Locale } from "../lib/i18n";

export type AppTheme = "light" | "dark";

export type AppShellState =
  | Readonly<{ kind: "server-selection" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "offline" }>
  | Readonly<{ kind: "error"; message: string }>;

type Palette = Readonly<{
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
}>;

const palettes: Record<AppTheme, Palette> = {
  light: {
    background: "#F4F7F8",
    surface: "#FFFFFF",
    text: "#15202B",
    muted: "#586875",
    accent: "#28674F",
    border: "#DCE5E8",
  },
  dark: {
    background: "#111820",
    surface: "#1B2730",
    text: "#F3F6F7",
    muted: "#B0BDC5",
    accent: "#A2D6BB",
    border: "#34434C",
  },
};

export function AppShellScreen({
  state,
  locale,
  theme,
  onRetry,
}: Readonly<{
  state: AppShellState;
  locale: Locale;
  theme: AppTheme;
  onRetry?: () => void;
}>) {
  const palette = palettes[theme];
  const content = renderState(state, locale, palette, onRetry);

  return (
    <SafeAreaView
      testID="app-shell"
      edges={["top", "bottom"]}
      style={{ ...styles.root, backgroundColor: palette.background }}
    >
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View
            style={{ ...styles.brandMark, backgroundColor: palette.accent }}
          >
            <Text style={styles.brandMarkText}>V</Text>
          </View>
          <Text style={{ ...styles.brandName, color: palette.text }}>
            vaehor
          </Text>
        </View>
        {content}
        <Text style={{ ...styles.footer, color: palette.muted }}>
          {t(locale, "shell.footer")}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function renderState(
  state: AppShellState,
  locale: Locale,
  palette: Palette,
  onRetry?: () => void,
) {
  if (state.kind === "loading") {
    return (
      <View
        style={{
          ...styles.card,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        }}
      >
        <ActivityIndicator color={palette.accent} size="large" />
        <Text style={{ ...styles.stateTitle, color: palette.text }}>
          {t(locale, "shell.loading")}
        </Text>
      </View>
    );
  }

  if (state.kind === "server-selection") {
    return (
      <View
        style={{
          ...styles.card,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        }}
      >
        <Text style={{ ...styles.eyebrow, color: palette.accent }}>
          {t(locale, "shell.serverSelection.eyebrow")}
        </Text>
        <Text style={{ ...styles.stateTitle, color: palette.text }}>
          {t(locale, "shell.serverSelection.title")}
        </Text>
        <Text style={{ ...styles.description, color: palette.muted }}>
          {t(locale, "shell.serverSelection.message")}
        </Text>
      </View>
    );
  }

  const isOffline = state.kind === "offline";
  const title = isOffline
    ? t(locale, "offline.title")
    : t(locale, "shell.error.title");
  const message = isOffline ? t(locale, "offline.message") : state.message;

  return (
    <View
      style={{
        ...styles.card,
        backgroundColor: palette.surface,
        borderColor: palette.border,
      }}
    >
      <Text style={{ ...styles.stateTitle, color: palette.text }}>{title}</Text>
      <Text style={{ ...styles.description, color: palette.muted }}>
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={{ ...styles.retryButton, backgroundColor: palette.accent }}
        >
          <Text style={styles.retryText}>{t(locale, "offline.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 28,
  },
  brandMark: {
    alignItems: "center",
    borderRadius: 13,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  brandMarkText: { color: "#FFFFFF", fontSize: 22, fontWeight: "700" },
  brandName: { fontSize: 20, fontWeight: "700", letterSpacing: 0.2 },
  card: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  stateTitle: { fontSize: 25, fontWeight: "700", lineHeight: 32 },
  description: { fontSize: 16, lineHeight: 24, marginTop: 10 },
  retryButton: {
    alignItems: "center",
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 24,
    minHeight: 50,
    paddingHorizontal: 20,
  },
  retryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  footer: { fontSize: 13, lineHeight: 20, marginTop: 24, textAlign: "center" },
});
