"use client";

import { TabsContent } from "@/components/ui/tabs";
import { useConfirm } from "@/components/providers/ModalProvider";
import {
  addAdminEmailAction,
  addEditorEmailAction,
  removeAdminEmailAction,
  removeEditorEmailAction,
} from "@/app/actions/admin";
import { useAppStore } from "@/lib/store";
import { Loader2, Trash2, UserPlus, Users } from "lucide-react";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export function AdminUsersTab(props: Readonly<{ sessionEmail: string }>) {
  const { adminEmails, editorEmails, addToast } = useAppStore();
  const { confirm } = useConfirm();
  const router = useRouter();
  const t = useTranslations("AdminPage");

  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [isSubmittingAdmin, setIsSubmittingAdmin] = useState(false);

  const [newEditorEmail, setNewEditorEmail] = useState("");
  const [isSubmittingEditor, setIsSubmittingEditor] = useState(false);

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail.trim()) return;
    setIsSubmittingAdmin(true);
    try {
      const result = await addAdminEmailAction(newAdminEmail);
      addToast({ message: result.message, type: "success" });
      router.refresh();
    } finally {
      setIsSubmittingAdmin(false);
    }
    setNewAdminEmail("");
  };

  const handleRemoveAdmin = async (email: string) => {
    if (
      await confirm(t("removeAdminConfirm", { email }), {
        title: t("removeAdminTitle"),
        variant: "destructive",
      })
    ) {
      const result = await removeAdminEmailAction(email);
      addToast({ message: result.message, type: "success" });
      router.refresh();
    }
  };

  const handleAddEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEditorEmail.trim()) return;
    setIsSubmittingEditor(true);
    try {
      const result = await addEditorEmailAction(newEditorEmail);
      addToast({ message: result.message, type: "success" });
      router.refresh();
    } finally {
      setIsSubmittingEditor(false);
    }
    setNewEditorEmail("");
  };

  const handleRemoveEditor = async (email: string) => {
    if (
      await confirm(
        t("removeEditorConfirm", { email }) || `Remove ${email} from Editors?`,
        {
          title: t("removeEditorTitle") || "Remove Editor",
          variant: "destructive",
        },
      )
    ) {
      const result = await removeEditorEmailAction(email);
      addToast({ message: result.message, type: "success" });
      router.refresh();
    }
  };

  return (
    <TabsContent value="users" className="mt-2">
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 sm:p-6 border-b">
          <h2 className="text-lg font-semibold mb-4">{t("addAdmin")}</h2>
          <form
            onSubmit={handleAddAdmin}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-grow">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                type="email"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                required
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border bg-background focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmittingAdmin}
              className="w-full sm:w-auto px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmittingAdmin ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <UserPlus size={18} />
              )}
              <span>{t("add")}</span>
            </button>
          </form>
        </div>

        <div className="p-4 sm:p-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">
            {t("adminList")}
          </h3>
          <div className="space-y-3">
            {adminEmails.map((email) => (
              <div
                key={email}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border hover:border-border/80 transition-colors"
              >
                <span className="text-sm font-medium truncate mr-2">
                  {email}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveAdmin(email)}
                  disabled={
                    props.sessionEmail === email && adminEmails.length === 1
                  }
                  className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-30"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t">
          <h2 className="text-lg font-semibold mb-4">Manage Editors</h2>
          <form
            onSubmit={handleAddEditor}
            className="flex flex-col sm:flex-row gap-3 mb-6"
          >
            <div className="relative flex-grow">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                type="email"
                value={newEditorEmail}
                onChange={(e) => setNewEditorEmail(e.target.value)}
                placeholder="Editor Email"
                required
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border bg-background focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmittingEditor}
              className="w-full sm:w-auto px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmittingEditor ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <UserPlus size={18} />
              )}
              <span>Add Editor</span>
            </button>
          </form>

          <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">
            Editor List
          </h3>
          <div className="space-y-3">
            {editorEmails.length === 0 ? (
              <p className="text-sm text-center py-4 text-muted-foreground">
                No editors configured.
              </p>
            ) : (
              editorEmails.map((email) => (
                <div
                  key={email}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border hover:border-border/80 transition-colors"
                >
                  <span className="text-sm font-medium truncate mr-2">
                    {email}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveEditor(email)}
                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </TabsContent>
  );
}
