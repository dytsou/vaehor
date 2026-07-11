import { z } from "zod";
import bcrypt from "bcryptjs";
import { REDIS_KEYS } from "@/lib/constants";
import { db } from "@/lib/db";
import { kv } from "@/lib/kv";

const manualDriveIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "Manual drive ID format is invalid.");

const manualDriveNameSchema = z.string().trim().min(1).max(120);

export const MANUAL_DRIVES_KEY = REDIS_KEYS.MANUAL_DRIVES;

export const manualDriveRecordSchema = z.object({
  id: manualDriveIdSchema,
  name: manualDriveNameSchema,
  isProtected: z.boolean().optional(),
});

export const manualDriveCreateSchema = z.object({
  id: manualDriveIdSchema,
  name: manualDriveNameSchema,
  password: z.string().trim().optional(),
});

export const manualDriveDeleteSchema = z.object({
  id: manualDriveIdSchema,
});

export type ManualDriveRecord = z.infer<typeof manualDriveRecordSchema>;
export type ManualDriveCreateInput = z.infer<typeof manualDriveCreateSchema>;

export function parseManualDriveRecords(value: unknown): ManualDriveRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => manualDriveRecordSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data);
}

const DUPLICATE_MANUAL_DRIVE_ERROR = "Folder ID ini sudah ada dalam daftar.";

export { DUPLICATE_MANUAL_DRIVE_ERROR };

function manualDriveCacheKey(id: string): string {
  return `vaehor:folder-path-v7:${id}`;
}

export async function addManualDrive(
  input: ManualDriveCreateInput,
): Promise<ManualDriveRecord[]> {
  const { id, name, password } = input;
  const currentDrives = parseManualDriveRecords(
    await kv.get(MANUAL_DRIVES_KEY),
  );

  if (currentDrives.some((drive) => drive.id === id)) {
    throw new Error(DUPLICATE_MANUAL_DRIVE_ERROR);
  }

  let isProtected = false;
  if (password && password.trim() !== "") {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.protectedFolder.upsert({
      where: { folderId: id },
      update: { password: hashedPassword },
      create: { folderId: id, password: hashedPassword },
    });
    isProtected = true;
  }

  const updatedDrives = [...currentDrives, { id, name, isProtected }];
  await kv.set(MANUAL_DRIVES_KEY, updatedDrives);
  await kv.del(manualDriveCacheKey(id));
  return updatedDrives;
}

export async function removeManualDrive(
  id: string,
): Promise<ManualDriveRecord[]> {
  const currentDrives = parseManualDriveRecords(
    await kv.get(MANUAL_DRIVES_KEY),
  );
  const updatedDrives = currentDrives.filter((drive) => drive.id !== id);

  await kv.set(MANUAL_DRIVES_KEY, updatedDrives);
  await db.protectedFolder.delete({ where: { folderId: id } }).catch(() => {});
  await kv.del(manualDriveCacheKey(id));
  return updatedDrives;
}

export function parseManualDrivesFromEnv(
  rawValue?: string,
): ManualDriveRecord[] {
  const envManualDrivesRaw = rawValue?.trim() || "";

  if (!envManualDrivesRaw) {
    return [];
  }

  if (envManualDrivesRaw.startsWith("[")) {
    try {
      const parsed = JSON.parse(envManualDrivesRaw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((entry) => {
          if (typeof entry === "string") {
            return manualDriveRecordSchema.safeParse({
              id: entry,
              name: entry,
            });
          }

          return manualDriveRecordSchema.safeParse(entry);
        })
        .filter((result) => result.success)
        .map((result) => result.data);
    } catch {
      return [];
    }
  }

  return envManualDrivesRaw
    .split(",")
    .map((entry) => {
      const [id, name] = entry.split(":");
      return manualDriveRecordSchema.safeParse({
        id,
        name: name?.trim() || id?.trim(),
      });
    })
    .filter((result) => result.success)
    .map((result) => result.data);
}
