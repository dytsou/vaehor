import { useCallback, useEffect, useState } from "react";
import * as Network from "expo-network";
import { useColorScheme } from "react-native";
import { AppShellScreen } from "../app-shell/AppShellScreen";
import { getDeviceLocale } from "../app-shell/locale";

export default function ServerSelectionRoute() {
  const [offline, setOffline] = useState(false);
  const theme = useColorScheme();

  const refreshNetwork = useCallback(async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      setOffline(
        state.isConnected === false || state.isInternetReachable === false,
      );
    } catch {
      setOffline(false);
    }
  }, []);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      setOffline(
        state.isConnected === false || state.isInternetReachable === false,
      );
    });
    void refreshNetwork();
    return () => subscription.remove();
  }, [refreshNetwork]);

  return (
    <AppShellScreen
      locale={getDeviceLocale()}
      theme={theme === "dark" ? "dark" : "light"}
      state={offline ? { kind: "offline" } : { kind: "server-selection" }}
      onRetry={() => void refreshNetwork()}
    />
  );
}
