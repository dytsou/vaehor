import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCreateScheduledUploadUrl,
  getGetScheduledUploadUrl,
  getListScheduledUploadsUrl,
  type CreateScheduledUploadRequest,
} from "@vaehor/sdk";
import { createServerFetch } from "../src/lib/api-client";
import {
  createScheduledUploadApi,
  ScheduledUploadApiError,
} from "../src/lib/scheduled-upload-api";

const manifest = {
  destinationId: "drive-root",
  scheduledLocalTime: "2030-01-02T10:00",
  timeZone: "Asia/Taipei",
  utcOffset: "+08:00",
  items: [
    {
      path: "reports/summary.txt",
      kind: "file",
      size: 12,
      contentType: "text/plain",
    },
  ],
} satisfies CreateScheduledUploadRequest;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scheduled upload mobile API", () => {
  it("uses generated endpoint URLs through the authenticated server fetch", async () => {
    const globalFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [], limits: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", globalFetch);

    const fetchImpl = createServerFetch(
      "https://vaehor.example",
      "session-token",
    );
    const api = createScheduledUploadApi(fetchImpl);

    await api.list({ cursor: "older-cursor" });

    const [url, init] = globalFetch.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(url).toBe(
      new URL(
        getListScheduledUploadsUrl({ cursor: "older-cursor" }),
        "https://vaehor.example",
      ).href,
    );
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer session-token",
    );
  });

  it("loads one schedule detail through the generated endpoint", async () => {
    const globalFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ schedule: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", globalFetch);

    const api = createScheduledUploadApi(
      createServerFetch("https://vaehor.example", "session-token"),
    );
    await api.get("schedule-1");

    const [url] = globalFetch.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(url).toBe(
      new URL(getGetScheduledUploadUrl("schedule-1"), "https://vaehor.example")
        .href,
    );
  });

  it("sends the generated create request body and reports server error details", async () => {
    const globalFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "SCHEDULED_UPLOAD_CAPACITY_EXCEEDED",
            message: "This package exceeds the private staging limit.",
          }),
          {
            status: 507,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", globalFetch);

    const api = createScheduledUploadApi(
      createServerFetch("https://vaehor.example", "session-token"),
    );

    await expect(api.create(manifest)).rejects.toMatchObject({
      name: "ScheduledUploadApiError",
      status: 507,
      body: {
        code: "SCHEDULED_UPLOAD_CAPACITY_EXCEEDED",
        message: "This package exceeds the private staging limit.",
      },
    } satisfies Partial<ScheduledUploadApiError>);

    const [url, init] = globalFetch.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(url).toBe(
      new URL(getCreateScheduledUploadUrl(), "https://vaehor.example").href,
    );
    expect(JSON.parse(String(init.body))).toEqual(manifest);
  });

  it.each([401, 403])(
    "preserves authorization failure status %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ message: "Access denied." }), {
              status,
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );

      const api = createScheduledUploadApi(
        createServerFetch("https://vaehor.example", "session-token"),
      );

      await expect(api.list()).rejects.toMatchObject({
        status,
        message: "Access denied.",
      });
    },
  );
});
