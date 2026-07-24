import type { OAuthFormData, SetupMode } from "../_lib/types";
import { SetupModeSwitcher } from "./SetupModeSwitcher";

const inputClassName =
  "w-full px-4 py-3 rounded-xl border border-border bg-background/50 backdrop-blur-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all";

type OAuthCredentialsStepProps = {
  setupMode: SetupMode;
  formData: OAuthFormData;
  onFormDataChange: (form: OAuthFormData) => void;
  onModeChange: (mode: SetupMode) => void;
  onAuthorize: () => void;
  t: (key: string) => string;
};

export function OAuthCredentialsStep({
  setupMode,
  formData,
  onFormDataChange,
  onModeChange,
  onAuthorize,
  t,
}: OAuthCredentialsStepProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <SetupModeSwitcher
        setupMode={setupMode}
        onModeChange={onModeChange}
        serviceAccountLabel={t("modeServiceAccount")}
        oauthLabel={t("modeOAuth")}
      />

      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("clientId")}</label>
          <input
            placeholder="xxxxx.apps.googleusercontent.com"
            className={inputClassName}
            value={formData.clientId}
            onChange={(e) =>
              onFormDataChange({ ...formData, clientId: e.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("clientSecret")}</label>
          <input
            type="password"
            placeholder="GOCSPX-xxxxx"
            className={inputClassName}
            value={formData.clientSecret}
            onChange={(e) =>
              onFormDataChange({ ...formData, clientSecret: e.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("rootFolderId")}</label>
          <input
            placeholder={t("rootFolderIdPlaceholder")}
            className={inputClassName}
            value={formData.rootFolderId}
            onChange={(e) =>
              onFormDataChange({ ...formData, rootFolderId: e.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            {t("rootFolderIdHint")}
            <span className="text-blue-500 font-mono">FOLDER_ID</span>
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onAuthorize}
        className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-6 py-3.5 rounded-xl font-medium transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {t("authorize")}
      </button>
    </div>
  );
}
