import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockKvZRange, mockSendMail, mockFormatBytes } = vi.hoisted(() => ({
  mockKvZRange: vi.fn(),
  mockSendMail: vi.fn(),
  mockFormatBytes: vi.fn(),
}));

vi.mock("@/lib/kv", () => ({
  kv: {
    zrange: mockKvZRange,
  },
}));

vi.mock("@/lib/mailer", () => ({
  sendMail: mockSendMail,
}));

vi.mock("@/lib/utils", () => ({
  formatBytes: mockFormatBytes,
}));

import { GET } from "@/app/api/cron/weekly-report/route";

function createCronRequest(authHeader?: string) {
  return new NextRequest("http://localhost:3000/api/cron/weekly-report", {
    headers: authHeader ? { authorization: authHeader } : undefined,
  });
}

describe("app/api/cron/weekly-report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret-test";
    process.env.ADMIN_EMAILS = "admin@example.com";
    mockFormatBytes.mockImplementation((value: number) => `${value}B`);
    mockKvZRange.mockResolvedValue([]);
    mockSendMail.mockResolvedValue(undefined);
  });

  it("returns 401 when authorization header is invalid", async () => {
    const response = await GET(createCronRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Unauthorized",
    });
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(createCronRequest("Bearer any-token"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "CRON_SECRET is not configured",
    });
  });

  it("returns no-admin message when admin emails are not configured", async () => {
    delete process.env.ADMIN_EMAILS;

    const response = await GET(
      createCronRequest(`Bearer ${process.env.CRON_SECRET}`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Tidak ada admin untuk dikirimi laporan.",
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("sends weekly report email with summarized activity", async () => {
    mockKvZRange.mockResolvedValue([
      JSON.stringify({ type: "UPLOAD", itemSize: "100" }),
      JSON.stringify({ type: "UPLOAD", itemSize: "50" }),
      JSON.stringify({ type: "DOWNLOAD", itemSize: "0" }),
    ]);

    const response = await GET(
      createCronRequest(`Bearer ${process.env.CRON_SECRET}`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Laporan mingguan berhasil dikirim.",
    });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["admin@example.com"],
        subject: "Laporan Aktivitas Mingguan vaehor",
      }),
    );
    expect(mockFormatBytes).toHaveBeenCalledWith(150);
  });

  it("returns 500 when report generation fails", async () => {
    mockKvZRange.mockRejectedValue(new Error("redis down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      createCronRequest(`Bearer ${process.env.CRON_SECRET}`),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Gagal memproses laporan.",
    });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
