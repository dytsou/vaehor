import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ZEE_MOBILE_MESSAGE,
  createZeeMobileBridge,
  getZeeMobileBridge,
  installZeeMobileBridge,
  isZeeMobileBridgeAvailable,
} from "@/lib/mobile-bridge";

describe("lib/mobile-bridge", () => {
  beforeEach(() => {
    vi.stubGlobal("parent", window);
    delete window.ZeeMobile;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.ZeeMobile;
  });

  it("is unavailable on a top-level web page", () => {
    expect(isZeeMobileBridgeAvailable()).toBe(false);
  });

  it("is available inside a native shell iframe", () => {
    vi.stubGlobal("parent", { postMessage: vi.fn() });
    expect(isZeeMobileBridgeAvailable()).toBe(true);
  });

  it("installs a bridge that requests native upload via postMessage", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });

    installZeeMobileBridge();
    const bridge = getZeeMobileBridge();
    expect(bridge).toBeTruthy();

    const pending = bridge!.pickAndUpload({ parentId: "folder-1" });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ZEE_MOBILE_MESSAGE,
        action: "upload/pick",
        parentId: "folder-1",
      }),
      "*",
    );

    const requestId = postMessage.mock.calls[0][0].requestId;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: ZEE_MOBILE_MESSAGE,
          action: "upload/pick-done",
          requestId,
        },
      }),
    );

    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects when native upload reports an error", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    const bridge = createZeeMobileBridge();

    const pending = bridge.pickAndUpload({ parentId: "folder-1" });
    const requestId = postMessage.mock.calls[0][0].requestId;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: ZEE_MOBILE_MESSAGE,
          action: "upload/pick-error",
          requestId,
          error: "Session expired",
        },
      }),
    );

    await expect(pending).rejects.toThrow("Session expired");
  });
});
