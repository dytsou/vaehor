import { auth } from "@/auth";
import type { AppSession } from "@/auth";

export type AdminSession = AppSession & {
  user: NonNullable<AppSession["user"]> & { role: "ADMIN" };
};

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await auth();

  if (session?.user?.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }

  return session as unknown as AdminSession;
}
