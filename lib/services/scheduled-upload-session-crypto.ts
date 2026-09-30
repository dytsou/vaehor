import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const SESSION_URI_MAX_LENGTH = 4096;
const VERSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type ScheduledUploadSessionKeyRing = Readonly<Record<string, string>>;

export interface EncryptedScheduledUploadSession {
  ciphertext: string;
  nonce: string;
  tag: string;
  keyVersion: string;
}

export interface ScheduledUploadSessionCryptoConfig {
  activeKeyVersion: string;
  keys: ScheduledUploadSessionKeyRing;
}

export class ScheduledUploadSessionCryptoError extends Error {
  constructor(readonly code: "MISSING_KEY" | "TAMPERED_SESSION") {
    super(
      code === "MISSING_KEY"
        ? "Scheduled upload session encryption key is unavailable."
        : "Scheduled upload session state could not be authenticated.",
    );
    this.name = "ScheduledUploadSessionCryptoError";
  }
}

function readEnvironmentConfig(): ScheduledUploadSessionCryptoConfig {
  const activeKeyVersion =
    process.env.SCHEDULED_UPLOAD_SESSION_ACTIVE_KEY_VERSION?.trim() ?? "";
  const rawKeys = process.env.SCHEDULED_UPLOAD_SESSION_KEYS?.trim() ?? "";
  if (!activeKeyVersion || !rawKeys) {
    throw new ScheduledUploadSessionCryptoError("MISSING_KEY");
  }

  try {
    const parsed: unknown = JSON.parse(rawKeys);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid key ring");
    }
    return {
      activeKeyVersion,
      keys: parsed as ScheduledUploadSessionKeyRing,
    };
  } catch {
    throw new ScheduledUploadSessionCryptoError("MISSING_KEY");
  }
}

function decodeKey(keyRing: ScheduledUploadSessionKeyRing, version: string) {
  const value = keyRing[version];
  if (
    !VERSION_PATTERN.test(version) ||
    typeof value !== "string" ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)
  ) {
    throw new ScheduledUploadSessionCryptoError("MISSING_KEY");
  }

  const key = Buffer.from(
    value.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  );
  if (key.byteLength !== 32) {
    throw new ScheduledUploadSessionCryptoError("MISSING_KEY");
  }
  return key;
}

export function assertScheduledUploadSessionEncryptionAvailable(
  config = readEnvironmentConfig(),
) {
  decodeKey(config.keys, config.activeKeyVersion);
}

function assertSessionUri(sessionUri: string): void {
  if (sessionUri.length > SESSION_URI_MAX_LENGTH) {
    throw new ScheduledUploadSessionCryptoError("TAMPERED_SESSION");
  }
  try {
    const parsed = new URL(sessionUri);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "www.googleapis.com" ||
      !parsed.pathname.startsWith("/upload/drive/v3/files") ||
      !parsed.searchParams.has("upload_id")
    ) {
      throw new Error("Invalid session URI");
    }
  } catch {
    throw new ScheduledUploadSessionCryptoError("TAMPERED_SESSION");
  }
}

export function encryptScheduledUploadSession(
  sessionUri: string,
  context: string,
  config = readEnvironmentConfig(),
): EncryptedScheduledUploadSession {
  assertSessionUri(sessionUri);
  const keyVersion = config.activeKeyVersion;
  const key = decodeKey(config.keys, keyVersion);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(sessionUri, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

export function decryptScheduledUploadSession(
  encrypted: EncryptedScheduledUploadSession,
  context: string,
  keys = readEnvironmentConfig().keys,
): string {
  const key = decodeKey(keys, encrypted.keyVersion);
  let plaintext: string;
  try {
    const nonce = Buffer.from(encrypted.nonce, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    if (nonce.byteLength !== NONCE_BYTES || tag.byteLength !== 16) {
      throw new Error("Invalid session state");
    }
    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ScheduledUploadSessionCryptoError("TAMPERED_SESSION");
  }
  assertSessionUri(plaintext);
  return plaintext;
}
