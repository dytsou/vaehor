export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createPublicRoute } from "@/lib/api-middleware";
import { invalidateAccessToken } from "@/lib/drive";
import { isAppConfigured } from "@/lib/config";
import { isAllowedSetupRequestOrigin } from "@/lib/setup-request";
import { verifySetupSecret } from "@/lib/setup-secret";
import { hasPersistedSetupConfig } from "@/app/api/setup/finish/route";
import { logger } from "@/lib/logger";
import { z } from "zod";

function escapeForDoubleQuotedEnv(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

const setupFinishServiceAccountSchema = z
  .object({
    serviceAccountEmail: z.string().email(),
    serviceAccountKey: z.string().min(1),
    rootFolderId: z.string().min(1),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
  })
  .refine(
    (data) =>
      (!data.clientId && !data.clientSecret) ||
      (Boolean(data.clientId?.trim()) && Boolean(data.clientSecret?.trim())),
    { message: "Client ID and Client Secret must both be set or both omitted" },
  );

export const POST = createPublicRoute(
  async ({ body, request }) => {
    try {
      const secretCheck = verifySetupSecret(request);
      if (secretCheck) {
        return secretCheck;
      }

      if (!isAllowedSetupRequestOrigin(request)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const envPath = path.join(process.cwd(), ".env");
      let envContent = "";
      try {
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf-8");
        }
      } catch (e) {
        console.error("Failed to read .env:", e);
      }

      const isConfigured = await isAppConfigured();
      if (isConfigured || hasPersistedSetupConfig(envContent)) {
        return NextResponse.json(
          {
            error:
              "Setup has already been completed. Reset database to re-configure.",
          },
          { status: 403 },
        );
      }

      const {
        serviceAccountEmail,
        serviceAccountKey,
        rootFolderId,
        clientId,
        clientSecret,
      } = body;

      const updateEnv = (key: string, value: string) => {
        const regex = new RegExp(`^${key}=.*$`, "m");
        const escaped = escapeForDoubleQuotedEnv(value);
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}="${escaped}"`);
        } else {
          envContent += `\n${key}="${escaped}"`;
        }
      };

      updateEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", serviceAccountEmail.trim());
      updateEnv("GOOGLE_SERVICE_ACCOUNT_KEY", serviceAccountKey);
      updateEnv("NEXT_PUBLIC_ROOT_FOLDER_ID", rootFolderId.trim());
      updateEnv("GOOGLE_REFRESH_TOKEN", "");

      if (clientId?.trim() && clientSecret?.trim()) {
        updateEnv("GOOGLE_CLIENT_ID", clientId.trim());
        updateEnv("GOOGLE_CLIENT_SECRET", clientSecret.trim());
      }

      let writeSuccess = false;
      try {
        fs.writeFileSync(envPath, envContent.trim() + "\n");
        writeSuccess = true;
      } catch (e: unknown) {
        console.error("Failed to write .env:", e);
      }

      const manualConfigData: Record<string, string> = {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail.trim(),
        GOOGLE_SERVICE_ACCOUNT_KEY: serviceAccountKey,
        NEXT_PUBLIC_ROOT_FOLDER_ID: rootFolderId.trim(),
      };
      if (clientId?.trim() && clientSecret?.trim()) {
        manualConfigData.GOOGLE_CLIENT_ID = clientId.trim();
        manualConfigData.GOOGLE_CLIENT_SECRET = clientSecret.trim();
      }

      try {
        await invalidateAccessToken();
      } catch {}

      return NextResponse.json({
        success: true,
        restartNeeded: writeSuccess,
        manualConfigNeeded: !writeSuccess,
        manualConfigData,
        message: writeSuccess
          ? "Configuration updated in .env. Restart the application to load changes."
          : "Could not write .env automatically. Copy the values below manually.",
      });
    } catch (error: unknown) {
      logger.error({ err: error }, "Setup finish (service account) failed");
      return NextResponse.json(
        { error: "Internal Server Error" },
        { status: 500 },
      );
    }
  },
  { rateLimit: false, bodySchema: setupFinishServiceAccountSchema },
);
