import { Stack, type ErrorBoundaryProps, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppShellScreen } from "../app-shell/AppShellScreen";
import { getDeviceLocale } from "../app-shell/locale";
import {
  completePendingOAuthCallback,
  parseOAuthCallbackUrl,
} from "../lib/oauth";
import { parseDeepLink, resolveShareDestination } from "../lib/deep-link";
import { preferencesStore } from "../lib/servers";

export default function RootLayout() {
  const theme = useColorScheme();
  const router = useRouter();
  const backgroundColor = theme === "dark" ? "#111820" : "#F4F7F8";

  useEffect(() => {
    let mounted = true;

    const handleUrl = async (url: string) => {
      if (!mounted) return;

      if (parseOAuthCallbackUrl(url)) {
        try {
          const completed = await completePendingOAuthCallback(url);
          if (mounted && completed) {
            router.replace({
              pathname: "/",
              params: { connected: completed.origin },
            });
          }
        } catch {
          if (mounted) {
            router.replace({
              pathname: "/",
              params: { authError: "oauth_callback_failed" },
            });
          }
        }
        return;
      }

      const parsed = parseDeepLink(url);
      if (parsed.kind !== "share") return;

      const servers = await preferencesStore.getServers();
      const destination = resolveShareDestination(parsed.target, servers);
      if (!mounted) return;
      router.push({
        pathname: "/share",
        params: {
          origin: parsed.target.origin,
          path: parsed.target.path,
          destination: destination.kind,
          ...(destination.kind === "bookmark"
            ? { serverId: destination.bookmark.id }
            : {}),
        },
      });
    };

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void handleUrl(url);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) void handleUrl(url);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [router]);

  return (
    <SafeAreaProvider>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor },
        }}
      />
    </SafeAreaProvider>
  );
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const theme = useColorScheme();

  return (
    <AppShellScreen
      locale={getDeviceLocale()}
      theme={theme === "dark" ? "dark" : "light"}
      state={{ kind: "error", message: error.message }}
      onRetry={retry}
    />
  );
}
