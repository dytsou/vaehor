import { describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  adminJsonRequest,
  adminRequest,
  redactAdminData,
} from "../src/lib/admin-api";

describe("native admin API", () => {
  it("parses a successful JSON response through the authenticated fetch boundary", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ users: 3 }), { status: 200 }),
    );

    await expect(adminRequest(fetchImpl, "/api/admin/stats")).resolves.toEqual({
      users: 3,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/stats", {});
  });

  it("keeps server denials actionable without exposing an internal response body", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: "Administrator access is required." }),
          { status: 403 },
        ),
    );

    await expect(
      adminRequest(fetchImpl, "/api/admin/config"),
    ).rejects.toMatchObject<Partial<AdminApiError>>({
      status: 403,
      message: "Administrator access is required.",
    });
  });

  it("builds JSON mutation requests and redacts nested credentials", () => {
    const request = adminJsonRequest("POST", { email: "admin@example.com" });
    expect(request).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com" }),
    });
    expect(
      redactAdminData({
        id: "one",
        token: "secret",
        nested: [{ password: "secret" }],
      }),
    ).toEqual({
      id: "one",
      token: "[redacted]",
      nested: [{ password: "[redacted]" }],
    });
  });
});
