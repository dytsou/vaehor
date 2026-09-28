import { describe, expect, it } from "vitest";
import { createAsyncRequestEpoch } from "../src/lib/async-request-epoch";

describe("async request epochs", () => {
  it("rejects a result when a newer request starts", () => {
    const requests = createAsyncRequestEpoch();
    const earlier = requests.begin();
    const later = requests.begin();

    expect(requests.isCurrent(earlier)).toBe(false);
    expect(requests.isCurrent(later)).toBe(true);
  });

  it("rejects a pending result after navigation invalidates it", () => {
    const requests = createAsyncRequestEpoch();
    const pending = requests.begin();

    requests.invalidate();

    expect(requests.isCurrent(pending)).toBe(false);
  });
});
