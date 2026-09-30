import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: "editor@example.com",
  abandonScheduledUpload: vi.fn(),
  cancelScheduledUpload: vi.fn(),
  commitScheduledUpload: vi.fn(),
  createScheduledUpload: vi.fn(),
  getScheduledUpload: vi.fn(),
  getScheduledUploadApiLimits: vi.fn(),
  listScheduledUploads: vi.fn(),
  readBoundedJson: vi.fn(),
  readScheduledUploadItemContent: vi.fn(),
  retryScheduledUpload: vi.fn(),
  stageScheduledUploadItem: vi.fn(),
  updateScheduledUploadTime: vi.fn(),
}));

vi.mock("@/lib/api-middleware", () => ({
  createUserRoute:
    (
      handler: (context: {
        request: Request;
        session: { user: { email: string } };
        params: Record<string, string>;
      }) => Promise<Response>,
    ) =>
    async (request: Request, context?: { params?: unknown }) => {
      try {
        const params = (await context?.params) ?? {};
        return await handler({
          request,
          session: { user: { email: mocks.email } },
          params: params as Record<string, string>,
        });
      } catch (error) {
        const status =
          error && typeof error === "object" && "status" in error
            ? Number(error.status)
            : 500;
        const message =
          error instanceof Error ? error.message : "Internal error";
        return Response.json({ error: message }, { status });
      }
    },
}));

vi.mock("@/lib/services/scheduled-upload", () => ({
  abandonScheduledUpload: mocks.abandonScheduledUpload,
  cancelScheduledUpload: mocks.cancelScheduledUpload,
  commitScheduledUpload: mocks.commitScheduledUpload,
  createScheduledUpload: mocks.createScheduledUpload,
  getScheduledUpload: mocks.getScheduledUpload,
  getScheduledUploadApiLimits: mocks.getScheduledUploadApiLimits,
  listScheduledUploads: mocks.listScheduledUploads,
  readBoundedJson: mocks.readBoundedJson,
  readScheduledUploadItemContent: mocks.readScheduledUploadItemContent,
  retryScheduledUpload: mocks.retryScheduledUpload,
  stageScheduledUploadItem: mocks.stageScheduledUploadItem,
  updateScheduledUploadTime: mocks.updateScheduledUploadTime,
}));

import {
  DELETE,
  GET as getDetail,
  PATCH,
} from "@/app/api/scheduled-uploads/[scheduleId]/route";
import { POST as commit } from "@/app/api/scheduled-uploads/[scheduleId]/commit/route";
import { POST as abandon } from "@/app/api/scheduled-uploads/[scheduleId]/abandon/route";
import {
  GET as getContent,
  PUT as putContent,
} from "@/app/api/scheduled-uploads/[scheduleId]/items/[itemId]/content/route";
import { POST as retry } from "@/app/api/scheduled-uploads/[scheduleId]/retry/route";
import {
  GET as getList,
  POST as postCreate,
} from "@/app/api/scheduled-uploads/route";

const schedule = {
  id: "schedule-id",
  status: "STAGING",
  items: [],
};

function request(path: string, method = "GET", body?: string) {
  return new NextRequest(`http://localhost/api/scheduled-uploads${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body, headers: { "content-type": "application/json" } }),
  });
}

describe("scheduled upload API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.email = "editor@example.com";
    mocks.getScheduledUploadApiLimits.mockReturnValue({ maxItems: 10 });
    mocks.listScheduledUploads.mockResolvedValue([schedule]);
    mocks.createScheduledUpload.mockResolvedValue(schedule);
    mocks.readBoundedJson.mockImplementation((input: Request) => input.json());
    mocks.getScheduledUpload.mockResolvedValue(schedule);
    mocks.updateScheduledUploadTime.mockResolvedValue(schedule);
    mocks.cancelScheduledUpload.mockResolvedValue(schedule);
    mocks.commitScheduledUpload.mockResolvedValue(schedule);
    mocks.retryScheduledUpload.mockResolvedValue(schedule);
    mocks.abandonScheduledUpload.mockResolvedValue(schedule);
    mocks.stageScheduledUploadItem.mockResolvedValue({
      itemId: "item-id",
      status: "STAGED",
    });
  });

  it("lists and creates only through authenticated owner-scoped handlers", async () => {
    const listed = await getList(request(""));
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.listScheduledUploads).toHaveBeenCalledWith({
      email: "editor@example.com",
    });

    const created = await postCreate(
      request(
        "",
        "POST",
        JSON.stringify({ destinationId: "drive-folder", items: [] }),
      ),
    );
    expect(created.status).toBe(201);
    expect(mocks.createScheduledUpload).toHaveBeenCalledWith(
      { destinationId: "drive-folder", items: [] },
      { email: "editor@example.com" },
    );
  });

  it("routes owner/admin detail, time, cancel, commit, retry, and abandon actions", async () => {
    const context = { params: Promise.resolve({ scheduleId: "schedule-id" }) };

    expect((await getDetail(request("/schedule-id"), context)).status).toBe(
      200,
    );
    expect(mocks.getScheduledUpload).toHaveBeenCalledWith("schedule-id", {
      email: "editor@example.com",
    });

    const timeBody = {
      scheduledLocalTime: "2027-02-01T10:00",
      timeZone: "Asia/Taipei",
      utcOffset: "+08:00",
    };
    expect(
      (
        await PATCH(
          request("/schedule-id", "PATCH", JSON.stringify(timeBody)),
          context,
        )
      ).status,
    ).toBe(200);
    expect(mocks.updateScheduledUploadTime).toHaveBeenCalledWith(
      "schedule-id",
      timeBody,
      { email: "editor@example.com" },
    );
    expect(
      (await DELETE(request("/schedule-id", "DELETE"), context)).status,
    ).toBe(200);
    expect(
      (await commit(request("/schedule-id/commit", "POST"), context)).status,
    ).toBe(200);
    expect(
      (await retry(request("/schedule-id/retry", "POST"), context)).status,
    ).toBe(200);
    expect(
      (await abandon(request("/schedule-id/abandon", "POST"), context)).status,
    ).toBe(200);
  });

  it("passes the request stream directly to staging without formData buffering", async () => {
    const bodyBytes = new TextEncoder().encode("file-bytes");
    const input = new NextRequest(
      "http://localhost/api/scheduled-uploads/schedule-id/items/item-id/content",
      { method: "PUT", body: bodyBytes },
    );
    const bodyStream = input.body;
    const formData = vi.spyOn(input, "formData");
    const context = {
      params: Promise.resolve({ scheduleId: "schedule-id", itemId: "item-id" }),
    };

    expect((await putContent(input, context)).status).toBe(200);
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.stageScheduledUploadItem).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: "schedule-id",
        itemId: "item-id",
        actor: { email: "editor@example.com" },
        body: bodyStream,
      }),
    );
  });

  it("streams content back as a private non-cacheable attachment", async () => {
    const bytes = new TextEncoder().encode("private bytes");
    mocks.readScheduledUploadItemContent.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      size: bytes.byteLength,
      contentType: "text/plain",
      fileName: "private.txt",
    });
    const context = {
      params: Promise.resolve({ scheduleId: "schedule-id", itemId: "item-id" }),
    };
    const response = await getContent(
      request("/schedule-id/items/item-id/content"),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "private.txt",
    );
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(await response.text()).toBe("private bytes");
  });

  it("keeps forbidden and nonexistent detail responses indistinguishable", async () => {
    const notFound = Object.assign(new Error("Scheduled upload not found."), {
      status: 404,
    });
    mocks.getScheduledUpload.mockRejectedValue(notFound);
    const context = { params: Promise.resolve({ scheduleId: "guessable-id" }) };
    const forbidden = await getDetail(request("/guessable-id"), context);
    mocks.getScheduledUpload.mockRejectedValue(notFound);
    const missing = await getDetail(request("/does-not-exist"), {
      params: Promise.resolve({ scheduleId: "does-not-exist" }),
    });

    expect(forbidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await forbidden.text()).toBe(await missing.text());
  });
});
