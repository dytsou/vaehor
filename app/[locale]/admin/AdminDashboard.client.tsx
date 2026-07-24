"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, FileRequestLink, ShareLink } from "@/lib/store";
import { useConfirm } from "@/components/providers/ModalProvider";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Clock,
  Copy,
  Eye,
  KeyRound,
  Link as LinkIcon,
  Palette,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Users,
} from "lucide-react";
import Loading from "@/components/common/Loading";
import { cn } from "@/lib/utils";
import type { AdminStats } from "@/lib/adminStats";
import { getAdminStatsAction } from "@/app/actions/admin";
import { useTranslations } from "next-intl";
import type { AdminDashboardProps } from "@/app/[locale]/admin/_client/admin-dashboard.types";
import { AdminTabs } from "@/app/[locale]/admin/_client/AdminTabs.client";
import { AdminSummaryTab } from "@/app/[locale]/admin/_client/AdminSummaryTab.client";
import { AdminAnalyticsTab } from "@/app/[locale]/admin/_client/AdminAnalyticsTab.client";
import { AdminUsersTab } from "@/app/[locale]/admin/_client/AdminUsersTab.client";
import { AdminSecurityTab } from "@/app/[locale]/admin/_client/AdminSecurityTab.client";
import { AdminBrandingTab } from "@/app/[locale]/admin/_client/AdminBrandingTab.client";
import { AdminLogsTab } from "@/app/[locale]/admin/_client/AdminLogsTab.client";

export function AdminDashboard(props: AdminDashboardProps) {
  const {
    user,
    shareLinks,
    removeShareLink,
    fileRequests,
    fetchFileRequests,
    removeFileRequest,
    addToast,
    fetchUser,
    fetchShareLinks,
    adminEmails,
  } = useAppStore();
  const { confirm } = useConfirm();
  const router = useRouter();
  const t = useTranslations("AdminPage");

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    if (!user) {
      fetchUser();
    }

    fetchShareLinks();
    fetchFileRequests();
    if (props.initialData?.adminEmails) {
      useAppStore.setState({ adminEmails: props.initialData.adminEmails });
    }
    if (props.initialData?.editorEmails) {
      useAppStore.setState({ editorEmails: props.initialData.editorEmails });
    }
    if (props.initialData?.config) {
      useAppStore.setState({
        hideAuthor: props.initialData.config.hideAuthor,
        appName: props.initialData.config.appName,
        logoUrl: props.initialData.config.logoUrl,
        faviconUrl: props.initialData.config.faviconUrl,
        primaryColor: props.initialData.config.primaryColor,
        localStorageAuthEnabled:
          props.initialData.config.localStorageAuthEnabled,
        localStoragePassword: props.initialData.config.localStoragePassword,
      });
    }

    if (props.initialData?.stats) {
      setStats(props.initialData.stats);
      setIsLoadingStats(false);
      return;
    }

    setIsLoadingStats(true);
    getAdminStatsAction()
      .then((data) => setStats(data))
      .catch((err) => {
        console.error("Stats fetch error:", err);
        addToast({
          message: t("loadingStatsError", { error: err.message }),
          type: "error",
        });
      })
      .finally(() => setIsLoadingStats(false));
  }, [
    user,
    fetchUser,
    fetchShareLinks,
    fetchFileRequests,
    addToast,
    t,
    props.initialData,
  ]);

  const { expiredLinks } = useMemo(() => {
    const now = new Date();
    const expired: ShareLink[] = [];
    (shareLinks || []).forEach((link: ShareLink) => {
      if (new Date(link.expiresAt) <= now) {
        expired.push(link);
      }
    });
    return { expiredLinks: expired };
  }, [shareLinks]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast({ message: t("linkCopied"), type: "success" });
  };

  const handleDelete = async (
    item: ShareLink | FileRequestLink,
    type: "share" | "request",
  ) => {
    if (
      await confirm(t("revokeConfirm"), {
        title: t("revokeTitle"),
        variant: "destructive",
        confirmText: t("revokeButton"),
      })
    ) {
      if (type === "share") {
        await removeShareLink(item as ShareLink);
      } else {
        await removeFileRequest((item as FileRequestLink).token);
      }
    }
  };

  if (!user) {
    return <Loading />;
  }

  const tabItems = [
    { value: "summary", label: t("summary"), icon: Activity },
    { value: "analytics", label: t("analytics"), icon: BarChart3 },
    { value: "users", label: t("admin"), icon: Users },
    { value: "security", label: t("security"), icon: ShieldCheck },
    { value: "branding", label: t("branding"), icon: Palette },
    { value: "logs", label: t("logs"), icon: Clock },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="container mx-auto py-6 px-4 sm:px-6 lg:px-8 max-w-7xl"
    >
      <div className="flex items-center gap-4 mb-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2.5 rounded-full bg-card border hover:bg-accent transition-colors shadow-sm"
          aria-label="Kembali"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <AdminTabs defaultValue="summary" items={tabItems}>
        <AdminSummaryTab
          shareLinksCount={shareLinks.length}
          activeRequestsCount={
            fileRequests.filter((r) => r.expiresAt > Date.now()).length
          }
          expiredLinksCount={expiredLinks.length}
          adminEmailsCount={adminEmails.length}
          stats={stats}
          isLoadingStats={isLoadingStats}
        />
        <AdminAnalyticsTab />
        <AdminUsersTab sessionEmail={props.sessionEmail} />
        <AdminSecurityTab
          initialProtectedFolders={props.initialData?.protectedFolders}
          initialUserAccessPermissions={
            props.initialData?.userAccessPermissions
          }
          initialAccessRequests={props.initialData?.accessRequests}
          initialManualDrives={props.initialData?.manualDrives}
        >
          {shareLinks.length === 0 && fileRequests.length === 0 ? (
            <div className="text-center py-12 bg-card border rounded-xl border-dashed">
              <LinkIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">{t("noActiveLinks")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {fileRequests.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 mb-2">
                    <UploadCloud size={16} /> {t("requestUpload")}
                  </h4>
                  <AnimatePresence>
                    {fileRequests.map((req) => {
                      const isExpired = req.expiresAt < Date.now();
                      const publicUrl = `${window.location.origin}/request/${req.token}`;
                      return (
                        <motion.div
                          key={req.token}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={cn(
                            "bg-card border rounded-xl p-4 shadow-sm relative overflow-hidden",
                            isExpired && "opacity-70 grayscale-[0.5]",
                          )}
                        >
                          <div className="flex flex-col gap-3">
                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0">
                                <h4 className="font-semibold text-base truncate pr-2">
                                  {req.title}
                                </h4>
                                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                  <Clock size={12} /> Exp:{" "}
                                  {format(req.expiresAt, "dd MMM HH:mm", {
                                    locale: id,
                                  })}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide shrink-0",
                                  isExpired
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/30"
                                    : "bg-green-100 text-green-700 dark:bg-green-900/30",
                                )}
                              >
                                {isExpired ? "Expired" : "Active"}
                              </span>
                            </div>

                            <div className="bg-muted/50 rounded-lg p-2 flex items-center gap-2">
                              <p className="text-xs font-mono text-muted-foreground truncate flex-1">
                                {publicUrl}
                              </p>
                              <button
                                type="button"
                                onClick={() => handleCopy(publicUrl)}
                                className="p-1.5 hover:bg-background rounded shadow-sm"
                              >
                                <Copy size={14} />
                              </button>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t mt-1">
                              <span className="text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded">
                                Folder: {req.folderName}
                              </span>

                              <button
                                onClick={() => handleDelete(req, "request")}
                                className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium"
                              >
                                <Trash2 size={16} /> Delete
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {shareLinks.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 mb-2">
                    <LinkIcon size={16} /> {t("shareLinks")}
                  </h4>
                  <AnimatePresence>
                    {shareLinks.map((link) => {
                      const isExpired = new Date(link.expiresAt) < new Date();
                      const shareUrl = `${window.location.origin}${link.path}?share_token=${link.token}`;

                      return (
                        <motion.div
                          key={link.id}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={cn(
                            "bg-card border rounded-xl p-4 shadow-sm",
                            isExpired && "opacity-70 border-dashed",
                          )}
                        >
                          <div className="flex flex-col gap-3">
                            <div className="flex justify-between items-start">
                              <div className="min-w-0 pr-2">
                                <h4 className="font-semibold text-base truncate text-primary">
                                  {link.itemName}
                                </h4>
                                <div className="flex items-center gap-3 mt-1">
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Eye size={12} /> {link.viewCount || 0}
                                  </span>
                                  {link.loginRequired && (
                                    <span className="text-[10px] border border-blue-200 text-blue-600 px-1.5 rounded flex items-center gap-1">
                                      <KeyRound size={10} /> Login
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span
                                className={cn(
                                  "w-2 h-2 rounded-full shrink-0 mt-2",
                                  isExpired ? "bg-red-500" : "bg-green-500",
                                )}
                                title={isExpired ? "Expired" : "Active"}
                              />
                            </div>

                            <div className="bg-muted/50 rounded-lg p-2.5 flex items-center gap-3">
                              <input
                                readOnly
                                value={shareUrl}
                                className="bg-transparent text-xs font-mono text-muted-foreground flex-1 outline-none min-w-0"
                              />
                              <button
                                onClick={() => handleCopy(shareUrl)}
                                className="p-1.5 bg-background hover:bg-accent rounded shadow-sm border"
                              >
                                <Copy size={14} />
                              </button>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-border/50">
                              <p className="text-xs text-muted-foreground">
                                Exp:{" "}
                                {format(
                                  new Date(link.expiresAt),
                                  "dd MMM yy, HH:mm",
                                  { locale: id },
                                )}
                              </p>
                              <button
                                onClick={() => handleDelete(link, "share")}
                                className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium flex items-center gap-1.5"
                              >
                                <Trash2 size={14} /> Delete
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </AdminSecurityTab>
        <AdminBrandingTab />
        <AdminLogsTab />
      </AdminTabs>
    </motion.div>
  );
}
