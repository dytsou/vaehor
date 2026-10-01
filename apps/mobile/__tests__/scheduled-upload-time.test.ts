import { describe, expect, it } from "vitest";
import {
  resolveScheduledUploadTime,
  ScheduledUploadTimeError,
} from "../src/lib/scheduled-upload-time";

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (cause) {
    return cause;
  }
  throw new Error("Expected the time to be rejected.");
}

describe("scheduled upload local time validation", () => {
  it("resolves the entered timezone offset for the requested local time", () => {
    expect(
      resolveScheduledUploadTime(
        "2030-01-02",
        "10:00",
        "Asia/Taipei",
        Date.parse("2029-01-01T00:00:00.000Z"),
      ),
    ).toEqual({
      scheduledLocalTime: "2030-01-02T10:00",
      timeZone: "Asia/Taipei",
      utcOffset: "+08:00",
    });
  });

  it.each([
    ["2026-03-08", "02:30", "nonexistent"],
    ["2026-11-01", "01:30", "ambiguous"],
    ["2020-01-01", "10:00", "past"],
  ] as const)("rejects %s %s (%s)", (date, time, code) => {
    expect(
      captureError(() =>
        resolveScheduledUploadTime(
          date,
          time,
          "America/New_York",
          Date.parse("2026-01-01T00:00:00.000Z"),
        ),
      ),
    ).toMatchObject({ code });
  });

  it("rejects invalid calendar values", () => {
    expect(() =>
      resolveScheduledUploadTime(
        "2030-02-30",
        "10:00",
        "Asia/Taipei",
        Date.parse("2029-01-01T00:00:00.000Z"),
      ),
    ).toThrowError(ScheduledUploadTimeError);
  });
});
