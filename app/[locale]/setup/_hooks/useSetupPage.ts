"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAlert } from "@/components/providers/ModalProvider";
import { useTranslations } from "next-intl";
import type {
  OAuthFormData,
  ServiceAccountFormData,
  SetupMode,
} from "../_lib/types";

export function useSetupPage() {
  const router = useRouter();
  const { alert } = useAlert();
  const t = useTranslations("SetupPage");
  const [setupMode, setSetupMode] = useState<SetupMode>("serviceAccount");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [manualConfig, setManualConfig] = useState<Record<
    string,
    string
  > | null>(null);
  const [writeSuccess, setWriteSuccess] = useState(false);
  const [formData, setFormData] = useState<OAuthFormData>({
    clientId: "",
    clientSecret: "",
    rootFolderId: "",
    authCode: "",
  });
  const [saForm, setSaForm] = useState<ServiceAccountFormData>({
    clientId: "",
    clientSecret: "",
    serviceAccountEmail: "",
    serviceAccountKey: "",
    rootFolderId: "",
  });
  const [requiresSetupToken, setRequiresSetupToken] = useState(false);
  const [setupToken, setSetupToken] = useState("");

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json() as Promise<{ requiresSetupToken?: boolean }>)
      .then((d) => setRequiresSetupToken(Boolean(d.requiresSetupToken)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (setupMode !== "oauth") return;
    if (!window.location.search.includes("code=") || step !== 1) return;

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const savedDataStr = localStorage.getItem("zee_setup_temp");
    const savedData = savedDataStr ? JSON.parse(savedDataStr) : {};

    if (!code || !savedData.clientId) return;

    setFormData((prev) => ({ ...prev, ...savedData, authCode: code }));
    setStep(2);
    window.history.replaceState({}, document.title, "/setup");
  }, [step, setupMode]);

  const ensureSetupTokenIfRequired = async (): Promise<boolean> => {
    if (requiresSetupToken && !setupToken.trim()) {
      await alert(t("setupTokenRequired"), { title: t("incompleteInput") });
      return false;
    }
    return true;
  };

  const setupFetchHeaders = (): HeadersInit => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (requiresSetupToken && setupToken.trim()) {
      h["X-Setup-Secret"] = setupToken.trim();
    }
    return h;
  };

  const handleAuthorize = async () => {
    if (!formData.clientId || !formData.clientSecret) {
      await alert(t("fillInputs"), { title: t("incompleteInput") });
      return;
    }

    const scope = "https://www.googleapis.com/auth/drive";
    const redirectUri = `${window.location.origin}/setup`;
    localStorage.setItem("zee_setup_temp", JSON.stringify(formData));

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${formData.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
    window.location.href = authUrl;
  };

  const handleFinishSetup = async () => {
    if (!(await ensureSetupTokenIfRequired())) return;

    setLoading(true);
    try {
      const res = await fetch("/api/setup/finish", {
        method: "POST",
        headers: setupFetchHeaders(),
        body: JSON.stringify({
          ...formData,
          redirectUri: `${window.location.origin}/setup`,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        localStorage.removeItem("zee_setup_temp");
        setManualConfig(data.manualConfigData || {});
        setWriteSuccess(data.restartNeeded);
        setStep(3);
        return;
      }

      await alert(`${t("setupFailed")}: ${data.error}`, {
        title: t("setupFailed"),
        variant: "destructive",
      });
    } catch {
      await alert(t("connectionError"), {
        title: "Error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFinishServiceAccount = async () => {
    if (
      !saForm.serviceAccountEmail.trim() ||
      !saForm.serviceAccountKey.trim() ||
      !saForm.rootFolderId.trim()
    ) {
      await alert(t("fillServiceAccountFields"), {
        title: t("incompleteInput"),
      });
      return;
    }

    if (!(await ensureSetupTokenIfRequired())) return;

    setLoading(true);
    try {
      const res = await fetch("/api/setup/finish-service-account", {
        method: "POST",
        headers: setupFetchHeaders(),
        body: JSON.stringify({
          serviceAccountEmail: saForm.serviceAccountEmail.trim(),
          serviceAccountKey: saForm.serviceAccountKey,
          rootFolderId: saForm.rootFolderId.trim(),
          clientId: saForm.clientId.trim() || undefined,
          clientSecret: saForm.clientSecret.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setManualConfig(data.manualConfigData);
        setWriteSuccess(data.restartNeeded);
        setStep(2);
        return;
      }

      await alert(`${t("setupFailed")}: ${data.error}`, {
        title: t("setupFailed"),
        variant: "destructive",
      });
    } catch {
      await alert(t("connectionError"), {
        title: "Error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const setMode = (mode: SetupMode) => {
    setSetupMode(mode);
    setStep(1);
    setManualConfig(null);
  };

  const showSummary =
    manualConfig != null &&
    ((setupMode === "oauth" && step === 3) ||
      (setupMode === "serviceAccount" && step === 2));

  return {
    router,
    alert,
    t,
    setupMode,
    step,
    loading,
    manualConfig,
    writeSuccess,
    formData,
    setFormData,
    saForm,
    setSaForm,
    requiresSetupToken,
    setupToken,
    setSetupToken,
    handleAuthorize,
    handleFinishSetup,
    handleFinishServiceAccount,
    setMode,
    showSummary,
  };
}

export type SetupPageState = ReturnType<typeof useSetupPage>;
