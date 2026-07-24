"use client";

import { useNotifications } from "@/hooks/useNotifications";
import { ReactNode } from "react";

export function AppInitializer({
  children,
}: Readonly<{ children: ReactNode }>) {
  useNotifications();

  return <>{children}</>;
}
