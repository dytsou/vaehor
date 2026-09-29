import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockSAdd, mockSRem, mockSMembers, mockRevalidateTag } = vi.hoisted(
  () => ({
    mockSAdd: vi.fn(),
    mockSRem: vi.fn(),
    mockSMembers: vi.fn(),
    mockRevalidateTag: vi.fn(),
  }),
);

vi.mock("@/lib/api-middleware", () => {
  type ParsedInput = {
    success: boolean;
    data?: unknown;
    error?: { issues: unknown[] };
  };
  type RouteOptions = {
    bodySchema?: { safeParse(value: unknown): ParsedInput };
    querySchema?: { safeParse(value: unknown): ParsedInput };
  };
  const wrap =
    (
      handler: (context: {
        request: NextRequest;
        query?: unknown;
        body?: unknown;
      }) => Promise<Response>,
      options?: RouteOptions,
    ) =>
    async (request: NextRequest) => {
      let body: unknown;
      let query: unknown;
      if (options?.bodySchema) {
        const parsed = options.bodySchema.safeParse(await request.json());
        if (!parsed.success)
          return Response.json(
            {
              error: "Input tidak valid.",
              details: parsed.error?.issues ?? [],
            },
            { status: 400 },
          );
        body = parsed.data;
      }
      if (options?.querySchema) {
        const parsed = options.querySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!parsed.success)
          return Response.json(
            { error: "Query tidak valid." },
            { status: 400 },
          );
        query = parsed.data;
      }
      return handler({ request, body, query });
    };
  return { createAdminRoute: wrap, createUserRoute: wrap };
});

vi.mock("@/lib/kv", () => ({
  kv: { sadd: mockSAdd, srem: mockSRem, smembers: mockSMembers },
}));
vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));

import { DELETE, GET, POST } from "@/app/api/mobile/tags/route";

const createRequest = (
  method: "POST" | "DELETE",
  body: Record<string, unknown>,
) =>
  new NextRequest("http://localhost:3000/api/mobile/tags", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("app/api/mobile/tags route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads tags for a requested file", async () => {
    mockSMembers.mockResolvedValue(["invoice", "2026"]);
    const response = await GET(
      new NextRequest("http://localhost:3000/api/mobile/tags?fileId=file-1"),
    );
    expect(mockSMembers).toHaveBeenCalledWith("zee_tags:file-1");
    await expect(response.json()).resolves.toEqual({
      tags: ["invoice", "2026"],
    });
  });

  it("adds and removes tags through administrator mutations", async () => {
    mockSAdd.mockResolvedValue(1);
    mockSRem.mockResolvedValue(1);
    const body = { fileId: "file-1", tag: "invoice" };
    const add = await POST(createRequest("POST", body));
    const remove = await DELETE(createRequest("DELETE", body));

    expect(mockSAdd).toHaveBeenCalledWith("zee_tags:file-1", "invoice");
    expect(mockSRem).toHaveBeenCalledWith("zee_tags:file-1", "invoice");
    expect(mockRevalidateTag).toHaveBeenCalledWith("tags:file-1", "max");
    await expect(add.json()).resolves.toEqual({ success: true });
    await expect(remove.json()).resolves.toEqual({ success: true });
  });

  it("rejects empty file and tag values", async () => {
    const response = await POST(
      createRequest("POST", { fileId: "", tag: " " }),
    );
    expect(response.status).toBe(400);
    expect(mockSAdd).not.toHaveBeenCalled();
  });
});
