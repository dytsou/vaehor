"use client";

import { TabsContent } from "@/components/ui/tabs";
import SecurityCenter from "@/components/admin/SecurityCenter";
import SecurityConfig from "@/components/admin/SecurityConfig";
import TwoFactorAuthSetup from "@/components/features/TwoFactorAuthSetup";
import ProtectedFoldersManager from "@/components/admin/ProtectedFoldersManager";
import UserFolderAccessManager from "@/components/admin/UserFolderAccessManager";
import ManualDrivesManager from "@/components/admin/ManualDrivesManager";
import type { AccessRequestRecord } from "@/lib/link-payloads";
import { FolderLock, HardDrive, Network, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

export function AdminSecurityTab(
  props: Readonly<{
    children?: React.ReactNode;
    initialProtectedFolders?: Record<string, { id: string; password: string }>;
    initialUserAccessPermissions?: Record<string, string[]>;
    initialAccessRequests?: AccessRequestRecord[];
    initialManualDrives?: { id: string; name: string; isProtected?: boolean }[];
  }>,
) {
  const t = useTranslations("AdminPage");

  return (
    <TabsContent value="security" className="mt-2 space-y-10">
      <section className="space-y-6">
        <SecurityCenter />
      </section>

      <section className="space-y-6">
        <div className="flex items-center gap-2 border-b pb-2 mb-4">
          <ShieldCheck className="text-primary" />
          <h3 className="text-lg font-bold">{t("basicConfig")}</h3>
        </div>
        <SecurityConfig />
        <div className="bg-card border rounded-xl p-4 sm:p-6 shadow-sm">
          <h4 className="text-base font-semibold mb-4">{t("twoFactor")}</h4>
          <TwoFactorAuthSetup />
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center gap-2 border-b pb-2 mb-4">
          <FolderLock className="text-amber-500" />
          <h3 className="text-lg font-bold">{t("protection")}</h3>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div>
            <ProtectedFoldersManager
              initialFolders={props.initialProtectedFolders}
            />
          </div>
          <div>
            <UserFolderAccessManager
              initialPermissions={props.initialUserAccessPermissions}
              initialRequests={props.initialAccessRequests}
            />
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center gap-2 border-b pb-2 mb-4">
          <HardDrive className="text-blue-500" />
          <h3 className="text-lg font-bold">{t("sharedDrives")}</h3>
        </div>
        <ManualDrivesManager
          initialDbDrives={props.initialManualDrives?.map((d) => ({
            ...d,
            source: "db" as const,
          }))}
        />
      </section>

      <section className="space-y-6">
        <div className="flex items-center gap-2 border-b pb-2 mb-4">
          <Network className="text-purple-500" />
          <h3 className="text-lg font-bold">{t("activeLinkManagement")}</h3>
        </div>

        {props.children}
      </section>
    </TabsContent>
  );
}
