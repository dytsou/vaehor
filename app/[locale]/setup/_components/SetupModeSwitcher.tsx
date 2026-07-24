import type { SetupMode } from "../_lib/types";

type SetupModeSwitcherProps = {
  setupMode: SetupMode;
  onModeChange: (mode: SetupMode) => void;
  serviceAccountLabel: string;
  oauthLabel: string;
};

export function SetupModeSwitcher({
  setupMode,
  onModeChange,
  serviceAccountLabel,
  oauthLabel,
}: Readonly<SetupModeSwitcherProps>) {
  const isServiceAccount = setupMode === "serviceAccount";

  return (
    <div className="flex rounded-xl border border-border p-1 bg-muted/30">
      <button
        type="button"
        onClick={() => onModeChange("serviceAccount")}
        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
          isServiceAccount ? "bg-background shadow-sm" : "text-muted-foreground"
        }`}
      >
        {serviceAccountLabel}
      </button>
      <button
        type="button"
        onClick={() => onModeChange("oauth")}
        className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
          isServiceAccount ? "text-muted-foreground" : "bg-background shadow-sm"
        }`}
      >
        {oauthLabel}
      </button>
    </div>
  );
}
