import { describe, expect, it } from "vitest";
import {
  formatMediaTime,
  formatMobileFileSize,
} from "../src/lib/mobile-formatters";

describe("mobile formatters", () => {
  it("formats media positions as total minutes and seconds", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(60.9)).toBe("1:00");
    expect(formatMediaTime(3600)).toBe("60:00");
    expect(formatMediaTime(-1)).toBe("0:00");
  });

  it("formats file sizes with the existing compact precision", () => {
    expect(formatMobileFileSize(0)).toBe("0 B");
    expect(formatMobileFileSize(1024)).toBe("1.0 KB");
    expect(formatMobileFileSize(10 * 1024)).toBe("10 KB");
    expect(formatMobileFileSize(1024 ** 4)).toBe("1.0 TB");
  });
});
