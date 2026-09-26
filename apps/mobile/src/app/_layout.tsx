import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppShellScreen } from "../app-shell/AppShellScreen";
import { getDeviceLocale } from "../app-shell/locale";

export default function RootLayout() {
  const theme = useColorScheme();
  const backgroundColor = theme === "dark" ? "#111820" : "#F4F7F8";

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
