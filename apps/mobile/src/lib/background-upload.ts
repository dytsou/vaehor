import { App } from "@capacitor/app";
import { BackgroundTask } from "@capawesome/capacitor-background-task";

export type BackgroundUploadDeps = {
  beforeExit: (cb: () => void | Promise<void>) => Promise<string>;
  finish: (options: { taskId: string }) => void;
  onAppStateChange: (handler: (isActive: boolean) => void) => () => void;
};

export const defaultBackgroundUploadDeps: BackgroundUploadDeps = {
  beforeExit: (cb) => BackgroundTask.beforeExit(cb),
  finish: (options) => BackgroundTask.finish(options),
  onAppStateChange(handler) {
    let listener: { remove: () => void } | undefined;
    void App.addListener("appStateChange", ({ isActive }) =>
      handler(isActive),
    ).then((handle) => {
      listener = handle;
    });
    return () => {
      void listener?.remove();
    };
  },
};

let activeScope: Promise<void> | null = null;
let resolveScope: (() => void) | null = null;
let unregisterStateListener: (() => void) | null = null;

function beginScope(): void {
  activeScope = new Promise((resolve) => {
    resolveScope = resolve;
  });
}

function endScope(): void {
  resolveScope?.();
  activeScope = null;
  resolveScope = null;
}

export function registerBackgroundUploadSupport(
  deps: BackgroundUploadDeps = defaultBackgroundUploadDeps,
): void {
  if (unregisterStateListener) return;

  unregisterStateListener = deps.onAppStateChange((isActive) => {
    if (isActive || !activeScope) return;

    void (async () => {
      const taskId = await deps.beforeExit(async () => {
        await activeScope;
      });
      deps.finish({ taskId });
    })();
  });
}

export async function runWithBackgroundUploadSupport<T>(
  work: () => Promise<T>,
  deps: BackgroundUploadDeps = defaultBackgroundUploadDeps,
): Promise<T> {
  registerBackgroundUploadSupport(deps);
  beginScope();
  try {
    return await work();
  } finally {
    endScope();
  }
}

export function resetBackgroundUploadSupportForTests(): void {
  endScope();
  unregisterStateListener?.();
  unregisterStateListener = null;
}
