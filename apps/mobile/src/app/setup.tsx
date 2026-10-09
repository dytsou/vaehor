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

type FinishOAuthOptions = Readonly<{
  clientId: string;
  clientSecret: string;
  rootFolderId: string;
  serverOrigin: string;
  isSetupTokenRequired: boolean;
  setupSecret: string;
  sendSetup: (
    path: "/api/setup/finish",
    body: Record<string, string>,
  ) => Promise<void>;
  setWorking: (working: boolean) => void;
  setError: (error: string | null) => void;
}>;

async function finishOAuthSetup(options: FinishOAuthOptions): Promise<void> {
  const {
    clientId,
    clientSecret,
    rootFolderId,
    serverOrigin,
    isSetupTokenRequired,
    setupSecret,
    sendSetup,
    setWorking,
    setError,
  } = options;
  setWorking(true);
  setError(null);
  try {
    if (!clientId.trim() || !clientSecret.trim() || !rootFolderId.trim()) {
      throw new Error(
        "Enter the Google OAuth client ID, client secret, and root folder ID.",
      );
    }
    if (!isSetupTokenRequired || !setupSecret.trim()) {
      throw new Error("This native setup requires the server's SETUP_SECRET.");
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
    if (browserResult.type !== "success") {
      throw new Error("Google authorization was cancelled.");
    }

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
    if (!authCode) {
      throw new Error("Google did not return an authorization code.");
    }

    await sendSetup("/api/setup/finish", {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      authCode,
      redirectUri,
      rootFolderId: rootFolderId.trim(),
    });
  } catch (cause) {
    setError(
      cause instanceof Error ? cause.message : "Setup could not be completed.",
    );
  } finally {
    setWorking(false);
  }
}
type SetupStatus = { requiresSetupToken: boolean };
type SetupResult = {
  success: boolean;
  restartNeeded: boolean;
  manualConfigNeeded: boolean;
  manualConfigData: Record<string, string> | null;
  message: string;
};

const driveScope = "https://www.googleapis.com/auth/drive";

type SetupPath = "/api/setup/finish" | "/api/setup/finish-service-account";

async function checkSetupServer(options: {
  origin: string;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setResult: (result: SetupResult | null) => void;
  setServerOrigin: (origin: string) => void;
  setSetupStatus: (status: SetupStatus | null) => void;
}): Promise<void> {
  options.setLoading(true);
  options.setError(null);
  options.setResult(null);
  try {
    const normalizedOrigin = requireSecureServerOrigin(options.origin);
    const response =
      await createPublicServerFetch(normalizedOrigin)("/api/setup/status");
    const body = (await response.json()) as SetupStatus & { error?: string };
    if (!response.ok)
      throw new Error(body.error || `Server returned ${response.status}.`);
    options.setServerOrigin(normalizedOrigin);
    options.setSetupStatus(body);
  } catch (cause) {
    options.setSetupStatus(null);
    options.setError(
      cause instanceof Error ? cause.message : "Could not reach the server.",
    );
  } finally {
    options.setLoading(false);
  }
}

async function sendSetupAction(options: {
  serverOrigin: string;
  setupStatus: SetupStatus | null;
  setupSecret: string;
  path: SetupPath;
  body: Record<string, string>;
  setResult: (result: SetupResult | null) => void;
}): Promise<void> {
  if (!options.setupStatus?.requiresSetupToken || !options.setupSecret.trim()) {
    throw new Error("This native setup requires the server's SETUP_SECRET.");
  }
  const response = await createPublicServerFetch(options.serverOrigin)(
    options.path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Secret": options.setupSecret.trim(),
      },
      body: JSON.stringify(options.body),
    },
  );
  const payload = (await response.json()) as SetupResult & { error?: string };
  if (!response.ok)
    throw new Error(payload.error || `Server returned ${response.status}.`);
  options.setResult(payload);
}

async function finishServiceAccountSetup(options: {
  serviceAccountEmail: string;
  serviceAccountKey: string;
  rootFolderId: string;
  clientId: string;
  clientSecret: string;
  sendSetup: (path: SetupPath, body: Record<string, string>) => Promise<void>;
  setWorking: (working: boolean) => void;
  setError: (error: string | null) => void;
}): Promise<void> {
  options.setWorking(true);
  options.setError(null);
  try {
    await options.sendSetup("/api/setup/finish-service-account", {
      serviceAccountEmail: options.serviceAccountEmail.trim(),
      serviceAccountKey: options.serviceAccountKey,
      rootFolderId: options.rootFolderId.trim(),
      ...(options.clientId.trim() && options.clientSecret.trim()
        ? {
            clientId: options.clientId.trim(),
            clientSecret: options.clientSecret.trim(),
          }
        : {}),
    });
  } catch (cause) {
    options.setError(
      cause instanceof Error ? cause.message : "Setup could not be completed.",
    );
  } finally {
    options.setWorking(false);
  }
}

type SetupColors = ReturnType<typeof mobileThemeColors>;
type SetupFieldOptions = Readonly<{
  secret?: boolean;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}>;

function SetupField({
  label,
  value,
  onChangeText,
  colors,
  options = {},
}: Readonly<{
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  colors: SetupColors;
  options?: SetupFieldOptions;
}>) {
  return (
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
}

function SetupStatusNotice({
  setupStatus,
  serverOrigin,
  colors,
}: Readonly<{
  setupStatus: SetupStatus;
  serverOrigin: string;
  colors: SetupColors;
}>) {
  return (
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
          Native setup requires SETUP_SECRET to be configured on the server.
        </Text>
      )}
    </View>
  );
}

function SetupModePicker({
  mode,
  setMode,
  setResult,
  setError,
}: Readonly<{
  mode: SetupMode;
  setMode: (mode: SetupMode) => void;
  setResult: (result: SetupResult | null) => void;
  setError: (error: string | null) => void;
}>) {
  return (
    <View style={styles.choices}>
      {(["serviceAccount", "oauth"] as const).map((value) => (
        <Pressable
          key={value}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === value }}
          style={[styles.choice, mode === value && styles.choiceSelected]}
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
            {value === "serviceAccount" ? "Service account" : "Google OAuth"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function ServiceAccountSetupForm({
  colors,
  serviceAccountEmail,
  setServiceAccountEmail,
  serviceAccountKey,
  setServiceAccountKey,
  rootFolderId,
  setRootFolderId,
  clientId,
  setClientId,
  clientSecret,
  setClientSecret,
  working,
  onSubmit,
}: Readonly<{
  colors: SetupColors;
  serviceAccountEmail: string;
  setServiceAccountEmail: (value: string) => void;
  serviceAccountKey: string;
  setServiceAccountKey: (value: string) => void;
  rootFolderId: string;
  setRootFolderId: (value: string) => void;
  clientId: string;
  setClientId: (value: string) => void;
  clientSecret: string;
  setClientSecret: (value: string) => void;
  working: boolean;
  onSubmit: () => void;
}>) {
  const canSubmit = Boolean(
    serviceAccountEmail.trim() &&
      serviceAccountKey.trim() &&
      rootFolderId.trim(),
  );
  return (
    <>
      <SetupField
        label="Service account email"
        value={serviceAccountEmail}
        onChangeText={setServiceAccountEmail}
        colors={colors}
      />
      <SetupField
        label="Service account private key"
        value={serviceAccountKey}
        onChangeText={setServiceAccountKey}
        colors={colors}
        options={{ secret: true, multiline: true }}
      />
      <SetupField
        label="Google Drive root folder ID"
        value={rootFolderId}
        onChangeText={setRootFolderId}
        colors={colors}
      />
      <SetupField
        label="OAuth client ID (optional)"
        value={clientId}
        onChangeText={setClientId}
        colors={colors}
      />
      <SetupField
        label="OAuth client secret (optional)"
        value={clientSecret}
        onChangeText={setClientSecret}
        colors={colors}
        options={{ secret: true }}
      />
      <Pressable
        accessibilityRole="button"
        style={[
          styles.primaryButton,
          (working || !canSubmit) && styles.disabled,
        ]}
        disabled={working || !canSubmit}
        onPress={onSubmit}
      >
        <Text style={styles.primaryButtonText}>
          {working ? "Saving…" : "Save service account setup"}
        </Text>
      </Pressable>
    </>
  );
}

function OAuthSetupForm({
  colors,
  clientId,
  setClientId,
  clientSecret,
  setClientSecret,
  rootFolderId,
  setRootFolderId,
  serverOrigin,
  working,
  onSubmit,
}: Readonly<{
  colors: SetupColors;
  clientId: string;
  setClientId: (value: string) => void;
  clientSecret: string;
  setClientSecret: (value: string) => void;
  rootFolderId: string;
  setRootFolderId: (value: string) => void;
  serverOrigin: string;
  working: boolean;
  onSubmit: () => void;
}>) {
  const canSubmit = Boolean(
    clientId.trim() && clientSecret.trim() && rootFolderId.trim(),
  );
  const callbackUrl = new URL(
    "/api/setup/native-callback",
    serverOrigin,
  ).toString();
  return (
    <>
      <SetupField
        label="Google OAuth client ID"
        value={clientId}
        onChangeText={setClientId}
        colors={colors}
      />
      <SetupField
        label="Google OAuth client secret"
        value={clientSecret}
        onChangeText={setClientSecret}
        colors={colors}
        options={{ secret: true }}
      />
      <SetupField
        label="Google Drive root folder ID"
        value={rootFolderId}
        onChangeText={setRootFolderId}
        colors={colors}
      />
      <Text style={[styles.body, { color: colors.muted }]}>
        Add this callback URL to the OAuth client’s authorized redirect URIs:{" "}
        {callbackUrl}
      </Text>
      <Pressable
        accessibilityRole="button"
        style={[
          styles.primaryButton,
          (working || !canSubmit) && styles.disabled,
        ]}
        disabled={working || !canSubmit}
        onPress={onSubmit}
      >
        <Text style={styles.primaryButtonText}>
          {working ? "Opening Google…" : "Authorize and finish setup"}
        </Text>
      </Pressable>
    </>
  );
}

function SetupCredentialSection(
  props: Readonly<{
    setupStatus: SetupStatus | null;
    setupSecret: string;
    setSetupSecret: (value: string) => void;
    mode: SetupMode;
    setMode: (mode: SetupMode) => void;
    setResult: (result: SetupResult | null) => void;
    setError: (error: string | null) => void;
    colors: SetupColors;
    serviceAccountEmail: string;
    setServiceAccountEmail: (value: string) => void;
    serviceAccountKey: string;
    setServiceAccountKey: (value: string) => void;
    rootFolderId: string;
    setRootFolderId: (value: string) => void;
    clientId: string;
    setClientId: (value: string) => void;
    clientSecret: string;
    setClientSecret: (value: string) => void;
    serverOrigin: string;
    working: boolean;
    onServiceAccountSubmit: () => void;
    onOAuthSubmit: () => void;
  }>,
) {
  if (!props.setupStatus?.requiresSetupToken) return null;
  return (
    <>
      <SetupField
        label="Setup secret"
        value={props.setupSecret}
        onChangeText={props.setSetupSecret}
        colors={props.colors}
        options={{ secret: true }}
      />
      <SetupModePicker
        mode={props.mode}
        setMode={props.setMode}
        setResult={props.setResult}
        setError={props.setError}
      />
      {props.mode === "serviceAccount" ? (
        <ServiceAccountSetupForm
          colors={props.colors}
          serviceAccountEmail={props.serviceAccountEmail}
          setServiceAccountEmail={props.setServiceAccountEmail}
          serviceAccountKey={props.serviceAccountKey}
          setServiceAccountKey={props.setServiceAccountKey}
          rootFolderId={props.rootFolderId}
          setRootFolderId={props.setRootFolderId}
          clientId={props.clientId}
          setClientId={props.setClientId}
          clientSecret={props.clientSecret}
          setClientSecret={props.setClientSecret}
          working={props.working}
          onSubmit={props.onServiceAccountSubmit}
        />
      ) : (
        <OAuthSetupForm
          colors={props.colors}
          clientId={props.clientId}
          setClientId={props.setClientId}
          clientSecret={props.clientSecret}
          setClientSecret={props.setClientSecret}
          rootFolderId={props.rootFolderId}
          setRootFolderId={props.setRootFolderId}
          serverOrigin={props.serverOrigin}
          working={props.working}
          onSubmit={props.onOAuthSubmit}
        />
      )}
    </>
  );
}

function SetupFeedback({
  error,
  result,
  working,
  colors,
}: Readonly<{
  error: string | null;
  result: SetupResult | null;
  working: boolean;
  colors: SetupColors;
}>) {
  return (
    <>
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
    </>
  );
}

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

  const checkServer = useCallback(
    (origin: string) =>
      checkSetupServer({
        origin,
        setLoading,
        setError,
        setResult,
        setServerOrigin,
        setSetupStatus,
      }),
    [],
  );

  useEffect(() => {
    if (typeof params.serverOrigin === "string" && params.serverOrigin.trim()) {
      void checkServer(params.serverOrigin);
    }
  }, [checkServer, params.serverOrigin]);

  const sendSetup = (path: SetupPath, body: Record<string, string>) =>
    sendSetupAction({
      serverOrigin,
      setupStatus,
      setupSecret,
      path,
      body,
      setResult,
    });

  const finishServiceAccount = () =>
    finishServiceAccountSetup({
      serviceAccountEmail,
      serviceAccountKey,
      rootFolderId,
      clientId,
      clientSecret,
      sendSetup,
      setWorking,
      setError,
    });

  const finishOAuth = () =>
    finishOAuthSetup({
      clientId,
      clientSecret,
      rootFolderId,
      serverOrigin,
      isSetupTokenRequired: setupStatus?.requiresSetupToken === true,
      setupSecret,
      sendSetup,
      setWorking,
      setError,
    });

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

        <SetupField
          label="Server HTTPS address"
          value={serverOrigin}
          onChangeText={setServerOrigin}
          colors={colors}
        />
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
          <SetupStatusNotice
            setupStatus={setupStatus}
            serverOrigin={serverOrigin}
            colors={colors}
          />
        ) : null}
        <SetupCredentialSection
          setupStatus={setupStatus}
          setupSecret={setupSecret}
          setSetupSecret={setSetupSecret}
          mode={mode}
          setMode={setMode}
          setResult={setResult}
          setError={setError}
          colors={colors}
          serviceAccountEmail={serviceAccountEmail}
          setServiceAccountEmail={setServiceAccountEmail}
          serviceAccountKey={serviceAccountKey}
          setServiceAccountKey={setServiceAccountKey}
          rootFolderId={rootFolderId}
          setRootFolderId={setRootFolderId}
          clientId={clientId}
          setClientId={setClientId}
          clientSecret={clientSecret}
          setClientSecret={setClientSecret}
          serverOrigin={serverOrigin}
          working={working}
          onServiceAccountSubmit={finishServiceAccount}
          onOAuthSubmit={finishOAuth}
        />
        <SetupFeedback
          error={error}
          result={result}
          working={working}
          colors={colors}
        />
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
