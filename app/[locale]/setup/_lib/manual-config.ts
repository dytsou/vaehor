export const MANUAL_CONFIG_KEY_ORDER = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "NEXT_PUBLIC_ROOT_FOLDER_ID",
] as const;

const MANUAL_CONFIG_LABEL_KEYS: Record<string, string> = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "serviceAccountEmail",
  GOOGLE_SERVICE_ACCOUNT_KEY: "privateKey",
  GOOGLE_CLIENT_ID: "clientId",
  GOOGLE_CLIENT_SECRET: "clientSecret",
  GOOGLE_REFRESH_TOKEN: "refreshToken",
  NEXT_PUBLIC_ROOT_FOLDER_ID: "rootFolderId",
};

export function manualConfigLabel(
  key: string,
  t: (key: string) => string,
): string {
  const labelKey = MANUAL_CONFIG_LABEL_KEYS[key];
  return labelKey ? t(labelKey) : key;
}

export function orderedManualEntries(
  config: Record<string, string>,
  t: (key: string) => string,
) {
  const keys = new Set(Object.keys(config));
  const orderSet = new Set<string>(MANUAL_CONFIG_KEY_ORDER);
  const ordered: string[] = [];

  for (const k of MANUAL_CONFIG_KEY_ORDER) {
    if (keys.has(k)) ordered.push(k);
  }
  for (const k of Object.keys(config)) {
    if (!orderSet.has(k)) ordered.push(k);
  }

  return ordered.map((key) => ({
    key,
    label: manualConfigLabel(key, t),
    value: config[key] ?? "",
  }));
}
