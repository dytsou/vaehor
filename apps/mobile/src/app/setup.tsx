import { useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { mobileThemeColors } from "../lib/mobile-theme";
import { useMobilePreferences } from "../lib/mobile-preferences";
import {
  createPublicServerFetch,
  requireSecureServerOrigin,
} from "../lib/api-client";

type SetupMode = "serviceAccount" | "oauth";
type SetupStatus = { requiresSetupToken: boolean };
type SetupResult = {
  success: boolean;
  restartNeeded: boolean;
  manualConfigNeeded: boolean;
  manualConfigData: Record<string, string> | null;
  message: string;
};

const driveScope = "https://www.googleapis.com/auth/drive";

export default function SetupRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ serverOrigin?: string }>();
  const { theme } = useMobilePreferences();
  const colors = useMemo(() => mobileThemeColors(theme === "dark"), [theme]);
  const [serverOrigin, setServerOrigin] = useState(
    typeof params.serverOrigin === "string" ? params.serverOrigin : "",
  );
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [mode, setMode] = useState<SetupMode>("serviceAccount");
  const [setupSecret, setSetupSecret] = useState("");
  const [serviceAccountEmail, setServiceAccountEmail] = useState("");
  const [serviceAccountKey, setServiceAccountKey] = useState("");
  const [rootFolderId, setRootFolderId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [result, setResult] = useState<SetupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkServer = useCallback(async (origin: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const normalizedOrigin = requireSecureServerOrigin(origin);
      const response =
        await createPublicServerFetch(normalizedOrigin)("/api/setup/status");
      const body = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok)
        throw new Error(body.error || `Server returned ${response.status}.`);
      setServerOrigin(normalizedOrigin);
      setSetupStatus(body);
    } catch (cause) {
      setSetupStatus(null);
      setError(
        cause instanceof Error ? cause.message : "Could not reach the server.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof params.serverOrigin === "string" && params.serverOrigin.trim()) {
      void checkServer(params.serverOrigin);
    }
  }, [checkServer, params.serverOrigin]);

  const sendSetup = async (
    path: "/api/setup/finish" | "/api/setup/finish-service-account",
    body: Record<string, string>,
  ) => {
    if (!setupStatus?.requiresSetupToken || !setupSecret.trim()) {
      throw new Error("This native setup requires the server's SETUP_SECRET.");
    }
    const response = await createPublicServerFetch(serverOrigin)(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Secret": setupSecret.trim(),
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as SetupResult & { error?: string };
    if (!response.ok)
      throw new Error(payload.error || `Server returned ${response.status}.`);
    setResult(payload);
  };

  const finishServiceAccount = async () => {
    setWorking(true);
    setError(null);
    try {
      await sendSetup("/api/setup/finish-service-account", {
        serviceAccountEmail: serviceAccountEmail.trim(),
        serviceAccountKey,
        rootFolderId: rootFolderId.trim(),
        ...(clientId.trim() && clientSecret.trim()
          ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
          : {}),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Setup could not be completed.",
      );
    } finally {
      setWorking(false);
    }
  };

  const finishOAuth = async () => {
    setWorking(true);
    setError(null);
    try {
      if (!clientId.trim() || !clientSecret.trim() || !rootFolderId.trim()) {
        throw new Error(
          "Enter the Google OAuth client ID, client secret, and root folder ID.",
        );
      }
      if (!setupStatus?.requiresSetupToken || !setupSecret.trim()) {
        throw new Error(
          "This native setup requires the server's SETUP_SECRET.",
        );
      }

      const redirectUri = new URL(
        "/api/setup/native-callback",
        serverOrigin,
      ).toString();
      const returnUrl = Linking.createURL("/setup", {
        scheme: "vaehor",
        queryParams: { serverOrigin },
      });
      const state = Crypto.randomUUID();
      const authorizationUrl = new URL(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      authorizationUrl.searchParams.set("client_id", clientId.trim());
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", driveScope);
      authorizationUrl.searchParams.set("access_type", "offline");
      authorizationUrl.searchParams.set("prompt", "consent");
      authorizationUrl.searchParams.set("state", state);

      const browserResult = await WebBrowser.openAuthSessionAsync(
        authorizationUrl.toString(),
        returnUrl,
      );
      if (browserResult.type !== "success")
        throw new Error("Google authorization was cancelled.");

      const callback = new URL(browserResult.url);
      if (callback.searchParams.get("serverOrigin") !== serverOrigin) {
        throw new Error("Google authorization returned to a different server.");
      }
      if (callback.searchParams.get("state") !== state) {
        throw new Error(
          "Google authorization state did not match. Please retry.",
        );
      }
      const authCode = callback.searchParams.get("code");
      if (!authCode)
        throw new Error("Google did not return an authorization code.");

      await sendSetup("/api/setup/finish", {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        authCode,
        redirectUri,
        rootFolderId: rootFolderId.trim(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Setup could not be completed.",
      );
    } finally {
      setWorking(false);
    }
  };

  const field = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    options: {
      secret?: boolean;
      multiline?: boolean;
      autoCapitalize?: "none" | "sentences" | "words" | "characters";
    } = {},
  ) => (
    <View style={styles.field} key={label}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={options.secret && !options.multiline}
        multiline={options.multiline}
        autoCapitalize={options.autoCapitalize ?? "none"}
        autoCorrect={false}
        placeholder={label}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          options.multiline && styles.multiline,
          { color: colors.foreground, borderColor: colors.border },
        ]}
      />
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.action}>‹ Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Server setup
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              Configure a self-hosted server
            </Text>
          </View>
        </View>

        {field("Server HTTPS address", serverOrigin, setServerOrigin)}
        <Pressable
          style={styles.secondaryButton}
          disabled={loading || working}
          onPress={() => void checkServer(serverOrigin)}
        >
          <Text style={styles.secondaryButtonText}>
            {loading ? "Checking…" : "Check server"}
          </Text>
        </Pressable>
        {setupStatus ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.body, { color: colors.foreground }]}>
              Server: {serverOrigin}
            </Text>
            {setupStatus.requiresSetupToken ? (
              <Text style={[styles.body, { color: colors.muted }]}>
                Setup token protection is enabled.
              </Text>
            ) : (
              <Text style={styles.error}>
                Native setup requires SETUP_SECRET to be configured on the
                server.
              </Text>
            )}
          </View>
        ) : null}

        {setupStatus?.requiresSetupToken ? (
          <>
            {field("Setup secret", setupSecret, setSetupSecret, {
              secret: true,
            })}
            <View style={styles.choices}>
              {(["serviceAccount", "oauth"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === value }}
                  style={[
                    styles.choice,
                    mode === value && styles.choiceSelected,
                  ]}
                  onPress={() => {
                    setMode(value);
                    setResult(null);
                    setError(null);
                  }}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      mode === value && styles.choiceTextSelected,
                    ]}
                  >
                    {value === "serviceAccount"
                      ? "Service account"
                      : "Google OAuth"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === "serviceAccount" ? (
              <>
                {field(
                  "Service account email",
                  serviceAccountEmail,
                  setServiceAccountEmail,
                )}
                {field(
                  "Service account private key",
                  serviceAccountKey,
                  setServiceAccountKey,
                  { secret: true, multiline: true },
                )}
                {field(
                  "Google Drive root folder ID",
                  rootFolderId,
                  setRootFolderId,
                )}
                {field("OAuth client ID (optional)", clientId, setClientId)}
                {field(
                  "OAuth client secret (optional)",
                  clientSecret,
                  setClientSecret,
                  { secret: true },
                )}
                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.primaryButton,
                    (working ||
                      !serviceAccountEmail.trim() ||
                      !serviceAccountKey.trim() ||
                      !rootFolderId.trim()) &&
                      styles.disabled,
                  ]}
                  disabled={
                    working ||
                    !serviceAccountEmail.trim() ||
                    !serviceAccountKey.trim() ||
                    !rootFolderId.trim()
                  }
                  onPress={() => void finishServiceAccount()}
                >
                  <Text style={styles.primaryButtonText}>
                    {working ? "Saving…" : "Save service account setup"}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                {field("Google OAuth client ID", clientId, setClientId)}
                {field(
                  "Google OAuth client secret",
                  clientSecret,
                  setClientSecret,
                  { secret: true },
                )}
                {field(
                  "Google Drive root folder ID",
                  rootFolderId,
                  setRootFolderId,
                )}
                <Text style={[styles.body, { color: colors.muted }]}>
                  Add this callback URL to the OAuth client’s authorized
                  redirect URIs:{" "}
                  {new URL(
                    "/api/setup/native-callback",
                    serverOrigin,
                  ).toString()}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.primaryButton,
                    (working ||
                      !clientId.trim() ||
                      !clientSecret.trim() ||
                      !rootFolderId.trim()) &&
                      styles.disabled,
                  ]}
                  disabled={
                    working ||
                    !clientId.trim() ||
                    !clientSecret.trim() ||
                    !rootFolderId.trim()
                  }
                  onPress={() => void finishOAuth()}
                >
                  <Text style={styles.primaryButtonText}>
                    {working ? "Opening Google…" : "Authorize and finish setup"}
                  </Text>
                </Pressable>
              </>
            )}
          </>
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {result ? (
          <View
            style={[
              styles.result,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Setup finished
            </Text>
            <Text style={[styles.body, { color: colors.muted }]}>
              {result.message}
            </Text>
            {result.restartNeeded ? (
              <Text style={[styles.body, { color: colors.foreground }]}>
                Restart the server to load the new configuration.
              </Text>
            ) : null}
            {result.manualConfigNeeded && result.manualConfigData ? (
              <Text
                selectable
                style={[styles.config, { color: colors.foreground }]}
              >
                {Object.entries(result.manualConfigData)
                  .map(([key, value]) => `${key}="${value}"`)
                  .join("\n")}
              </Text>
            ) : null}
          </View>
        ) : null}

        {working ? <ActivityIndicator color="#1f6f78" /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 8,
  },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 3 },
  action: { color: "#1f6f78", fontSize: 15, fontWeight: "600" },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: {
    minHeight: 120,
    textAlignVertical: "top",
    fontFamily: "monospace",
  },
  notice: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  body: { fontSize: 14, lineHeight: 20 },
  choices: { flexDirection: "row", gap: 8 },
  choice: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cdd9da",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  choiceSelected: { borderColor: "#1f6f78", backgroundColor: "#e7f4f4" },
  choiceText: { fontSize: 13, color: "#475467", fontWeight: "600" },
  choiceTextSelected: { color: "#155e63" },
  primaryButton: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: "#1f6f78",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f6f78",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: "#1f6f78", fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  error: { color: "#b42318", fontSize: 14, lineHeight: 20 },
  result: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  config: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f2f4f7",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
});
