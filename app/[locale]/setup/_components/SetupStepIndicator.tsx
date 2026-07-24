import type { SetupMode } from "../_lib/types";

function stepCircleClass(active: boolean) {
  return `flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-all ${
    active ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
  }`;
}

function connectorClass(active: boolean) {
  return `flex-1 h-0.5 transition-all ${active ? "bg-blue-500" : "bg-border"}`;
}

function StepNode({
  step,
  active,
}: Readonly<{ step: number; active: boolean }>) {
  return <div className={stepCircleClass(active)}>{step}</div>;
}

export function SetupStepIndicator({
  setupMode,
  step,
}: Readonly<{
  setupMode: SetupMode;
  step: number;
}>) {
  const totalSteps = setupMode === "oauth" ? 3 : 2;
  const nodes = [];

  for (let stepNumber = 1; stepNumber <= totalSteps; stepNumber++) {
    if (stepNumber > 1) {
      nodes.push(
        <div
          key={`line-${stepNumber}`}
          className={connectorClass(step >= stepNumber)}
        />,
      );
    }
    nodes.push(
      <StepNode
        key={`step-${stepNumber}`}
        step={stepNumber}
        active={step >= stepNumber}
      />,
    );
  }

  return <div className="flex items-center gap-4 mb-10">{nodes}</div>;
}
