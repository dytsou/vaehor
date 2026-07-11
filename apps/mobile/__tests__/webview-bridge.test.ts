import { describe, expect, it, vi } from "vitest";
import { ZEE_MOBILE_MESSAGE } from "@vaehor/mobile-bridge-protocol";
import { attachUploadBridge } from "../src/plugins/upload-bridge";

describe("attachUploadBridge", () => {
  it("calls onLogout when iframe posts logout message", () => {
    const iframe = document.createElement("iframe");
    const childWindow = {} as Window;
    vi.spyOn(iframe, "contentWindow", "get").mockReturnValue(
      childWindow as unknown as Window,
    );

    const onLogout = vi.fn();
    attachUploadBridge({
      origin: "https://files.example.com",
      sessionToken: "session-token",
      iframe,
      onProgress: vi.fn(),
      onLogout,
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: ZEE_MOBILE_MESSAGE, action: "logout" },
        source: childWindow,
      }),
    );

    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
