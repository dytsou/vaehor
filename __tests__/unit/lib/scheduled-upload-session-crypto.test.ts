import { describe, expect, it } from "vitest";
import {
  decryptScheduledUploadSession,
  encryptScheduledUploadSession,
  ScheduledUploadSessionCryptoError,
  type ScheduledUploadSessionKeyRing,
} from "@/lib/services/scheduled-upload-session-crypto";

const sessionUri =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=opaque-session-token";
const keyV1 = Buffer.alloc(32, 1).toString("base64");
const keyV2 = Buffer.alloc(32, 2).toString("base64");
const v1: ScheduledUploadSessionKeyRing = { v1: keyV1 };

describe("scheduled upload session crypto", () => {
  it("encrypts the URI and keeps old ciphertext readable during rotation", () => {
    const encrypted = encryptScheduledUploadSession(
      sessionUri,
      "schedule:item",
      {
        activeKeyVersion: "v1",
        keys: v1,
      },
    );
    expect(encrypted.ciphertext).not.toContain("upload_id");
    expect(encrypted).toMatchObject({ keyVersion: "v1" });

    expect(
      decryptScheduledUploadSession(encrypted, "schedule:item", {
        v1: keyV1,
        v2: keyV2,
      }),
    ).toBe(sessionUri);
  });

  it("rejects missing and tampered key material without exposing the URI", () => {
    const encrypted = encryptScheduledUploadSession(
      sessionUri,
      "schedule:item",
      {
        activeKeyVersion: "v1",
        keys: v1,
      },
    );

    expect(() =>
      decryptScheduledUploadSession(encrypted, "schedule:item", { v2: keyV2 }),
    ).toThrowError(ScheduledUploadSessionCryptoError);
    expect(() =>
      decryptScheduledUploadSession(
        { ...encrypted, tag: Buffer.alloc(16).toString("base64") },
        "schedule:item",
        v1,
      ),
    ).toThrowError(ScheduledUploadSessionCryptoError);
    expect(() =>
      decryptScheduledUploadSession(encrypted, "different:item", v1),
    ).toThrowError(ScheduledUploadSessionCryptoError);
  });

  it("does not accept a session URI outside the Google Drive resumable endpoint", () => {
    expect(() =>
      encryptScheduledUploadSession(
        "https://attacker.example/upload?upload_id=secret",
        "schedule:item",
        { activeKeyVersion: "v1", keys: v1 },
      ),
    ).toThrowError(ScheduledUploadSessionCryptoError);
  });
});
