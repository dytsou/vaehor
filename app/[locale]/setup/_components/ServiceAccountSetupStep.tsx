import type { ServiceAccountFormData, SetupMode } from "../_lib/types";
import { SetupModeSwitcher } from "./SetupModeSwitcher";

const inputClassName =
  "w-full px-4 py-3 rounded-xl border border-border bg-background/50 backdrop-blur-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all";

type ServiceAccountSetupStepProps = {
  setupMode: SetupMode;
  saForm: ServiceAccountFormData;
  onSaFormChange: (form: ServiceAccountFormData) => void;
  onModeChange: (mode: SetupMode) => void;
  onSubmit: () => void;
  loading: boolean;
  t: (key: string) => string;
};

export function ServiceAccountSetupStep({
  setupMode,
  saForm,
  onSaFormChange,
  onModeChange,
  onSubmit,
  loading,
  t,
}: ServiceAccountSetupStepProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitleSa")}</p>
      </div>

      <SetupModeSwitcher
        setupMode={setupMode}
        onModeChange={onModeChange}
        serviceAccountLabel={t("modeServiceAccount")}
        oauthLabel={t("modeOAuth")}
      />

      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t("serviceAccountEmail")}
          </label>
          <input
            placeholder="name@project.iam.gserviceaccount.com"
            className={inputClassName}
            value={saForm.serviceAccountEmail}
            onChange={(e) =>
              onSaFormChange({ ...saForm, serviceAccountEmail: e.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("privateKey")}</label>
          <textarea
            rows={6}
            placeholder="-----BEGIN PRIVATE KEY-----"
            className={`${inputClassName} font-mono text-xs`}
            value={saForm.serviceAccountKey}
            onChange={(e) =>
              onSaFormChange({ ...saForm, serviceAccountKey: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">{t("privateKeyHint")}</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("rootFolderId")}</label>
          <input
            placeholder={t("rootFolderIdPlaceholder")}
            className={inputClassName}
            value={saForm.rootFolderId}
            onChange={(e) =>
              onSaFormChange({ ...saForm, rootFolderId: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {t("rootFolderIdHint")}
            <span className="text-blue-500 font-mono">FOLDER_ID</span>
          </p>
        </div>

        <div className="p-4 rounded-xl bg-muted/50 border border-border/50">
          <p className="text-sm font-medium mb-2">{t("nextAuthOptional")}</p>
          <p className="text-xs text-muted-foreground mb-4">
            {t("nextAuthOptionalDesc")}
          </p>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium">{t("clientId")}</label>
              <input
                placeholder="xxxxx.apps.googleusercontent.com"
                className="w-full px-4 py-2 rounded-lg border border-border bg-background text-sm"
                value={saForm.clientId}
                onChange={(e) =>
                  onSaFormChange({ ...saForm, clientId: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">{t("clientSecret")}</label>
              <input
                type="password"
                placeholder="GOCSPX-xxxxx"
                className="w-full px-4 py-2 rounded-lg border border-border bg-background text-sm"
                value={saForm.clientSecret}
                onChange={(e) =>
                  onSaFormChange({ ...saForm, clientSecret: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading}
        className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-6 py-3.5 rounded-xl font-medium transition-all shadow-lg shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? t("processing") : t("finishSetup")}
      </button>
    </div>
  );
}
