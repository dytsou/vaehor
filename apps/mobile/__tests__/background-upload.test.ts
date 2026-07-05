import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerBackgroundUploadSupport,
  resetBackgroundUploadSupportForTests,
  runWithBackgroundUploadSupport,
  type BackgroundUploadDeps,
} from "../src/lib/background-upload";

describe("background-upload", () => {
  beforeEach(() => {
    resetBackgroundUploadSupportForTests();
  });

  it("requests background time when the app backgrounds during upload", async () => {
    const beforeExit = vi.fn(async (cb: () => void | Promise<void>) => {
      await cb();
      return "task-1";
    });
    const finish = vi.fn();
    let backgroundHandler: ((isActive: boolean) => void) | null = null;

    const deps: BackgroundUploadDeps = {
      beforeExit,
      finish,
      onAppStateChange(handler) {
        backgroundHandler = handler;
        return () => {
          backgroundHandler = null;
        };
      },
    };

    registerBackgroundUploadSupport(deps);

    const upload = runWithBackgroundUploadSupport(async () => {
      backgroundHandler?.(false);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "done";
    }, deps);

    await expect(upload).resolves.toBe("done");
    expect(beforeExit).toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith({ taskId: "task-1" });
  });
});
