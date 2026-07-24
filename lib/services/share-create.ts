import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { SignJWT, decodeJwt } from "jose";
import crypto from "node:crypto";
import { getTranslations } from "next-intl/server";
import { kv } from "@/lib/kv";
import { db } from "@/lib/db";
import type { ShareLink } from "@/lib/store";
import { sendMail } from "@/lib/mailer";
import { getBaseUrl } from "@/lib/utils";
import type { ShareCreateRequest } from "@/lib/link-payloads";
import { REDIS_KEYS } from "@/lib/constants";

type ShareTranslationKey =
  | "securityPolicySensitive"
  | "invalidExpire"
  | "tokenExpired"
  | "createFail"
  | "emailSubject"
  | "collection"
  | "share"
  | "emailHello"
  | "emailBody"
  | "item"
  | "path"
  | "expiresAt"
  | "loginRequired"
  | "yes"
  | "no"
  | "manageText";

export type ShareTranslator = (
  key: ShareTranslationKey,
  values?: Record<string, unknown>,
) => string;

const SHARE_MESSAGES_ID: Record<ShareTranslationKey, string> = {
  securityPolicySensitive:
    "Kebijakan Keamanan: Dokumen sensitif wajib login untuk dibagikan.",
  invalidExpire:
    "Format expiresIn tidak valid. Gunakan format seperti: 1h, 7d, 30d",
  tokenExpired: "Token kedaluwarsa atau tidak valid.",
  createFail: "Gagal membuat tautan berbagi.",
  emailSubject: "Notifikasi {type} baru dibuat",
  collection: "Koleksi",
  share: "Berbagi",
  emailHello: "Halo Admin",
  emailBody: "{type} baru telah dibuat oleh {email}.",
  item: "Item:",
  path: "Path:",
  expiresAt: "Kedaluwarsa:",
  loginRequired: "Wajib Login:",
  yes: "Ya",
  no: "Tidak",
  manageText:
    "Silakan masuk ke dashboard admin untuk mengelola tautan berbagi ini.",
};

const SHARE_MESSAGES_EN: Record<ShareTranslationKey, string> = {
  securityPolicySensitive:
    "Security Policy: Sensitive documents require login before sharing.",
  invalidExpire: "Invalid expiresIn format. Use format like: 1h, 7d, 30d",
  tokenExpired: "Token expired or invalid.",
  createFail: "Failed to create share link.",
  emailSubject: "New {type} has been created",
  collection: "Collection",
  share: "Share",
  emailHello: "Hello Admin",
  emailBody: "A new {type} has been created by {email}.",
  item: "Item:",
  path: "Path:",
  expiresAt: "Expires At:",
  loginRequired: "Login Required:",
  yes: "Yes",
  no: "No",
  manageText: "Please open the admin dashboard to manage this share link.",
};

const SENSITIVE_KEYWORDS = [
  "ktp",
  "password",
  "rahasia",
  "secret",
  "keuangan",
  "finance",
  "invoice",
  "identitas",
  "credential",
  ".env",
  "id_card",
  "confidential",
  "slip_gaji",
] as const;

const VALID_EXPIRE_FORMAT = /^\d+[smhdw]$/;

function interpolate(
  template: string,
  values?: Record<string, unknown>,
): string {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

export async function getShareTranslator(
  locale: string,
): Promise<ShareTranslator> {
  const fallbackMessages =
    locale === "id" ? SHARE_MESSAGES_ID : SHARE_MESSAGES_EN;

  try {
    const translator = await getTranslations({
      locale,
      namespace: "Api.Share",
    });
    return (key, values) =>
      translator(key as Parameters<typeof translator>[0], values as never);
  } catch {
    return (key, values) => interpolate(fallbackMessages[key], values);
  }
}

export function getShareLocale(request: NextRequest): string {
  return request.cookies.get("NEXT_LOCALE")?.value || "id";
}

function hasSensitiveName(name: string): boolean {
  const lowerName = name.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => lowerName.includes(keyword));
}

function isSensitiveShareRequest(body: ShareCreateRequest): boolean {
  const isCollection = Boolean(body.items && body.items.length > 0);

  if (hasSensitiveName(body.itemName)) {
    return true;
  }

  return Boolean(
    isCollection &&
      body.items?.some((item) => item.name && hasSensitiveName(item.name)),
  );
}

export function validateShareCreateRequest(
  body: ShareCreateRequest,
  t: ShareTranslator,
): NextResponse | null {
  if (isSensitiveShareRequest(body) && !body.loginRequired) {
    return NextResponse.json(
      { error: t("securityPolicySensitive") },
      { status: 403 },
    );
  }

  if (!VALID_EXPIRE_FORMAT.test(body.expiresIn)) {
    return NextResponse.json({ error: t("invalidExpire") }, { status: 400 });
  }

  return null;
}

async function signShareToken(
  body: ShareCreateRequest,
  jti: string,
  t: ShareTranslator,
) {
  const secret = new TextEncoder().encode(process.env.SHARE_SECRET_KEY!);
  const token = await new SignJWT({
    shareId: jti,
    loginRequired: body.loginRequired ?? false,
    preventDownload: body.preventDownload ?? false,
    hasWatermark: body.hasWatermark ?? false,
    watermarkText: body.watermarkText || null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(body.expiresIn)
    .setJti(jti)
    .sign(secret);

  const decodedToken = decodeJwt(token);
  if (!decodedToken.exp) {
    throw new Error(t("tokenExpired"));
  }

  return { token, decodedToken };
}

async function storeCollectionItems(
  jti: string,
  items: NonNullable<ShareCreateRequest["items"]>,
  expiresAt: number,
) {
  const expiresInSeconds = (expiresAt * 1000 - Date.now()) / 1000;
  await kv.set(`${REDIS_KEYS.SHARE_ITEMS}${jti}`, items, {
    ex: Math.ceil(expiresInSeconds) + 3600,
  });
}

async function persistShareLinkRecord(
  body: ShareCreateRequest,
  jti: string,
  sharePath: string,
  token: string,
  expiresAtDate: Date,
  isCollection: boolean,
): Promise<ShareLink> {
  const shareLinkRecord = await db.shareLink.create({
    data: {
      id: jti,
      path: sharePath,
      token,
      jti,
      expiresAt: expiresAtDate,
      loginRequired: body.loginRequired ?? false,
      itemName: body.itemName,
      isCollection,
      maxUses: body.maxUses ?? null,
      preventDownload: body.preventDownload ?? false,
      hasWatermark: body.hasWatermark ?? false,
      watermarkText: body.watermarkText || null,
    },
  });

  return {
    id: shareLinkRecord.id,
    path: shareLinkRecord.path,
    token: shareLinkRecord.token,
    jti: shareLinkRecord.jti,
    expiresAt: shareLinkRecord.expiresAt.toISOString(),
    loginRequired: shareLinkRecord.loginRequired,
    itemName: shareLinkRecord.itemName,
    isCollection: shareLinkRecord.isCollection,
    maxUses: shareLinkRecord.maxUses,
    preventDownload: shareLinkRecord.preventDownload,
    hasWatermark: shareLinkRecord.hasWatermark,
    watermarkText: shareLinkRecord.watermarkText,
  };
}

async function notifyAdminsOfShare(
  body: ShareCreateRequest,
  session: Session | null,
  locale: string,
  t: ShareTranslator,
  sharePath: string,
  expiresAtDate: Date,
) {
  const adminEmails =
    process.env.ADMIN_EMAILS?.split(",")
      .map((email) => email.trim())
      .filter(Boolean) || [];

  if (adminEmails.length === 0) {
    return;
  }

  const isCollection = Boolean(body.items && body.items.length > 0);
  const shareType = isCollection ? t("collection") : t("share");

  await sendMail({
    to: adminEmails,
    subject: t("emailSubject", { type: shareType }),
    html: `
        <p>${t("emailHello")},</p>
        <p>${t("emailBody", {
          type: shareType.toLowerCase(),
          email: session?.user?.email || "Unknown",
        })}</p>
        <ul>
          <li><b>${t("item")}</b> ${body.itemName}</li>
          <li><b>${t("path")}</b> ${sharePath}</li>
          <li><b>${t("expiresAt")}</b> ${expiresAtDate.toLocaleString(
            locale === "id" ? "id-ID" : "en-US",
            { timeZone: "Asia/Jakarta" },
          )}</li>
          <li><b>${t("loginRequired")}</b> ${body.loginRequired ? t("yes") : t("no")}</li>
        </ul>
        <p>${t("manageText")}</p>
      `,
  });
}

export async function createShareLink(
  body: ShareCreateRequest,
  session: Session | null,
  locale: string,
  t: ShareTranslator,
) {
  const isCollection = Boolean(body.items && body.items.length > 0);
  const jti = crypto.randomUUID();
  const sharePath = isCollection ? `/share/${jti}` : body.path!;
  const { token, decodedToken } = await signShareToken(body, jti, t);

  if (isCollection && body.items) {
    await storeCollectionItems(jti, body.items, decodedToken.exp!);
  }

  const expiresAtDate = new Date(decodedToken.exp! * 1000);
  const newShareLink = await persistShareLinkRecord(
    body,
    jti,
    sharePath,
    token,
    expiresAtDate,
    isCollection,
  );

  await notifyAdminsOfShare(body, session, locale, t, sharePath, expiresAtDate);

  return {
    shareableUrl: `${getBaseUrl()}${sharePath}?share_token=${token}`,
    token,
    jti,
    newShareLink,
  };
}

export function shareCreateErrorResponse(t: ShareTranslator, error: unknown) {
  console.error("Error generating share link:", error);
  return NextResponse.json({ error: t("createFail") }, { status: 500 });
}
