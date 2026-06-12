import type { SetupPageState } from "../_hooks/useSetupPage";
import { OAuthConfirmStep } from "./OAuthConfirmStep";
import { OAuthCredentialsStep } from "./OAuthCredentialsStep";
import { ServiceAccountSetupStep } from "./ServiceAccountSetupStep";
import { SetupSummaryStep } from "./SetupSummaryStep";

type SetupView =
  | "serviceAccount"
  | "oauthCredentials"
  | "oauthConfirm"
  | "summary"
  | null;

function resolveSetupView(state: SetupPageState): SetupView {
  if (state.showSummary) return "summary";
  if (state.step === 1 && state.setupMode === "serviceAccount") {
    return "serviceAccount";
  }
  if (state.step === 1 && state.setupMode === "oauth") {
    return "oauthCredentials";
  }
  if (state.setupMode === "oauth" && state.step === 2) return "oauthConfirm";
  return null;
}

export function SetupStepContent(state: SetupPageState) {
  const view = resolveSetupView(state);

  switch (view) {
    case "serviceAccount":
      return (
        <ServiceAccountSetupStep
          setupMode={state.setupMode}
          saForm={state.saForm}
          onSaFormChange={state.setSaForm}
          onModeChange={state.setMode}
          onSubmit={state.handleFinishServiceAccount}
          loading={state.loading}
          t={state.t}
        />
      );
    case "oauthCredentials":
      return (
        <OAuthCredentialsStep
          setupMode={state.setupMode}
          formData={state.formData}
          onFormDataChange={state.setFormData}
          onModeChange={state.setMode}
          onAuthorize={state.handleAuthorize}
          t={state.t}
        />
      );
    case "oauthConfirm":
      return (
        <OAuthConfirmStep
          loading={state.loading}
          onFinish={state.handleFinishSetup}
          t={state.t}
        />
      );
    case "summary":
      if (!state.manualConfig) return null;
      return (
        <SetupSummaryStep
          manualConfig={state.manualConfig}
          writeSuccess={state.writeSuccess}
          onGoHome={() => state.router.push("/")}
          onCopy={(value) => {
            navigator.clipboard.writeText(value);
            state
              .alert(state.t("copied"), { title: state.t("success") })
              .catch(() => {});
          }}
          t={state.t}
        />
      );
    default:
      return null;
  }
}
