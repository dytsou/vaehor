"use client";

import { useSetupPage } from "./_hooks/useSetupPage";
import { SetupStepContent } from "./_components/SetupStepContent";
import { SetupStepIndicator } from "./_components/SetupStepIndicator";
import { SetupTokenField } from "./_components/SetupTokenField";

export default function SetupPage() {
  const setup = useSetupPage();

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 pointer-events-none" />

      <main className="relative flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-lg">
          <SetupStepIndicator setupMode={setup.setupMode} step={setup.step} />

          {setup.requiresSetupToken && !setup.showSummary && (
            <SetupTokenField
              setupToken={setup.setupToken}
              onSetupTokenChange={setup.setSetupToken}
              label={setup.t("setupTokenLabel")}
              placeholder={setup.t("setupTokenPlaceholder")}
              hint={setup.t("setupTokenHint")}
            />
          )}

          <SetupStepContent {...setup} />

          <p className="text-center text-xs text-muted-foreground pt-12 space-y-1">
            <span className="block">
              © 2025 All rights reserved -{" "}
              <a
                href="https://ifauzeee.vercel.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground hover:text-primary"
              >
                Muhammad Ibnu Fauzi
              </a>
            </span>
            <span className="block">
              © {new Date().getFullYear()} Modifications by{" "}
              <a
                href="https://github.com/dytsou/drive-uploader"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground hover:text-primary"
              >
                dytsou
              </a>
            </span>
          </p>
        </div>
      </main>
    </div>
  );
}
