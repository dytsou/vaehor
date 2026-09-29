import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { mobileThemeColors } from "../lib/mobile-theme";
import {
  useMobilePreferences,
  type AppearancePreference,
  type LanguagePreference,
} from "../lib/mobile-preferences";

const appearanceOptions: AppearancePreference[] = ["system", "light", "dark"];
const languageOptions: LanguagePreference[] = ["system", "en", "zh"];

export default function SettingsRoute() {
  const router = useRouter();
  const { preferences, theme, locale, ready, setAppearance, setLanguage } =
    useMobilePreferences();
  const colors = mobileThemeColors(theme === "dark");
  const [error, setError] = useState<string | null>(null);
  const isChinese = locale === "zh";

  const copy = isChinese
    ? {
        back: "返回",
        title: "設定",
        appearance: "外觀",
        language: "語言",
        system: "跟隨系統",
        light: "淺色",
        dark: "深色",
        english: "English",
        chinese: "簡體中文",
        error: "無法儲存設定，請重試。",
      }
    : {
        back: "Back",
        title: "Settings",
        appearance: "Appearance",
        language: "Language",
        system: "System",
        light: "Light",
        dark: "Dark",
        english: "English",
        chinese: "Simplified Chinese",
        error: "Could not save this setting. Please retry.",
      };

  const appearanceLabels: Record<AppearancePreference, string> = {
    system: copy.system,
    light: copy.light,
    dark: copy.dark,
  };
  const languageLabels: Record<LanguagePreference, string> = {
    system: copy.system,
    en: copy.english,
    zh: copy.chinese,
  };

  const update = async (change: () => Promise<void>) => {
    setError(null);
    try {
      await change();
    } catch {
      setError(copy.error);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.back}>{copy.back}</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {copy.title}
          </Text>
        </View>

        {!ready ? <ActivityIndicator color="#1f6f78" /> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.heading, { color: colors.foreground }]}>
            {copy.appearance}
          </Text>
          <View style={styles.options}>
            {appearanceOptions.map((option) => {
              const selected = preferences.appearance === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => void update(() => setAppearance(option))}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected ? "#1f6f78" : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: selected ? "#ffffff" : colors.foreground },
                    ]}
                  >
                    {appearanceLabels[option]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.heading, { color: colors.foreground }]}>
            {copy.language}
          </Text>
          <View style={styles.options}>
            {languageOptions.map((option) => {
              const selected = preferences.language === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => void update(() => setLanguage(option))}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected ? "#1f6f78" : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: selected ? "#ffffff" : colors.foreground },
                    ]}
                  >
                    {languageLabels[option]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    gap: 18,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginBottom: 8,
  },
  back: { color: "#1f6f78", fontSize: 15, fontWeight: "600" },
  title: { fontSize: 24, fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: 14, gap: 14, padding: 16 },
  heading: { fontSize: 17, fontWeight: "700" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionText: { fontSize: 14, fontWeight: "600" },
  error: { color: "#b42318", fontSize: 14 },
});
