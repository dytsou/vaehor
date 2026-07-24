import { orderedManualEntries } from "../_lib/manual-config";

type SetupSummaryStepProps = {
  manualConfig: Record<string, string>;
  writeSuccess: boolean;
  onGoHome: () => void;
  onCopy: (value: string) => void;
  t: (key: string) => string;
};

export function SetupSummaryStep({
  manualConfig,
  writeSuccess,
  onGoHome,
  onCopy,
  t,
}: Readonly<SetupSummaryStepProps>) {
  const entries = orderedManualEntries(manualConfig, t);

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center text-center">
        <div
          className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${
            writeSuccess
              ? "from-green-400 to-green-600 shadow-green-500/30"
              : "from-yellow-400 to-yellow-600 shadow-yellow-500/30"
          } flex items-center justify-center mb-6 shadow-lg`}
        >
          {writeSuccess ? (
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          )}
        </div>
        <h1 className="text-2xl font-semibold mb-2">
          {t("manualConfigTitle")}
        </h1>
        <p className="text-muted-foreground max-w-sm">
          {writeSuccess ? t("setupSuccessRedirect") : t("manualConfigDesc")}
        </p>
      </div>

      {!writeSuccess && (
        <div className="space-y-4">
          {entries.map((item) => (
            <div key={item.key} className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {item.label}
              </label>
              <div className="relative group">
                <input
                  readOnly
                  value={item.value}
                  className="w-full px-4 py-3 pr-20 rounded-xl border border-border bg-muted/30 font-mono text-xs focus:outline-none max-h-32 overflow-y-auto"
                />
                <button
                  type="button"
                  onClick={() => onCopy(item.value)}
                  className="absolute right-2 top-1.5 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium hover:bg-muted transition-colors"
                >
                  {t("copy")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!writeSuccess && (
        <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10">
          <p className="text-xs text-blue-500/80 leading-relaxed italic">
            * {t("envNote")}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onGoHome}
        className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-6 py-3.5 rounded-xl font-medium transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
      >
        {t("understand")}
      </button>
    </div>
  );
}
