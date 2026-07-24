export type DriveAuthMode = "service_account" | "oauth_refresh";

export type ServiceAccountCredentials = {
  mode: "service_account";
  serviceAccountEmail: string;
  privateKey: string;
  rootFolderId: string;
};

export type OAuthRefreshCredentials = {
  mode: "oauth_refresh";
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string;
};

/** Drive API credentials (service account preferred when both modes are configured). */
export type AppDriveCredentials =
  | ServiceAccountCredentials
  | OAuthRefreshCredentials;

function resolveRootFolderIdFromEnv(): string {
  return (
    process.env.NEXT_PUBLIC_ROOT_FOLDER_ID?.trim() ||
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() ||
    ""
  );
}

function normalizeServiceAccountKey(raw: string): string {
  return raw.replaceAll("\\n", "\n").trim();
}

export async function getAppCredentials(): Promise<AppDriveCredentials | null> {
  const rootFolderId = resolveRootFolderIdFromEnv();

  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const saKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (saEmail && saKeyRaw !== undefined && saKeyRaw !== "") {
    const privateKey = normalizeServiceAccountKey(saKeyRaw);
    if (privateKey.length > 0) {
      return {
        mode: "service_account",
        serviceAccountEmail: saEmail,
        privateKey,
        rootFolderId,
      };
    }
  }

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    return {
      mode: "oauth_refresh",
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
      rootFolderId,
    };
  }

  return null;
}

export async function isAppConfigured(): Promise<boolean> {
  const creds = await getAppCredentials();
  if (!creds) return false;
  if (creds.mode === "service_account") {
    return !!creds.rootFolderId;
  }
  return true;
}

export async function getRootFolderId(): Promise<string> {
  const creds = await getAppCredentials();
  return creds?.rootFolderId || resolveRootFolderIdFromEnv();
}
