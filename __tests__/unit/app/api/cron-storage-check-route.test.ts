import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetStorageDetails,
  mockSendMail,
  mockFormatBytes,
  mockKvGet,
  mockKvSet,
} = vi.hoisted(() => ({
  mockGetStorageDetails: vi.fn(),
  mockSendMail: vi.fn(),
  mockFormatBytes: vi.fn(),
  mockKvGet: vi.fn(),
  mockKvSet: vi.fn(),
}));

vi.mock("@/lib/drive", () => ({
  getStorageDetails: mockGetStorageDetails,
}));

vi.mock("@/lib/mailer", () => ({
  sendMail: mockSendMail,
}));

vi.mock("@/lib/utils", () => ({
  formatBytes: mockFormatBytes,
}));

vi.mock("@/lib/kv", () => ({
  kv: {
    get: mockKvGet,
    set: mockKvSet,
  },
}));

import { GET } from "@/app/api/cron/storage-check/route";

function createCronRequest(authHeader?: string) {
  return new NextRequest("http://localhost:3000/api/cron/storage-check", {
    headers: authHeader ? { authorization: authHeader } : undefined,
  });
}

describe("app/api/cron/storage-check route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret-test";
    process.env.STORAGE_WARNING_THRESHOLD = "0.9";
    process.env.ADMIN_EMAILS = "admin1@example.com, admin2@example.com";

    mockFormatBytes.mockImplementation((value: number) => `${value}B`);
    mockKvSet.mockResolvedValue("OK");
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

  it("returns safe message when usage is below threshold", async () => {
    mockGetStorageDetails.mockResolvedValue({ usage: 10, limit: 100 });

    const response = await GET(
      createCronRequest(`Bearer ${process.env.CRON_SECRET}`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Kapasitas penyimpanan masih aman.",
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("skips sending warning when one was sent recently", async () => {
    mockGetStorageDetails.mockResolvedValue({ usage: 95, limit: 100 });
    mockKvGet.mockResolvedValue(Date.now().toString());

    const response = await GET(
      createCronRequest(`Bearer ${process.env.CRON_SECRET}`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Peringatan sudah dikirim baru-baru ini.",
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("sends warning email when usage is above threshold and no recent warning", async () => {
    mockGetStorageDetails.mockResolvedValue({ usage: 95, limit: 100 });
    mockKvGet.mockResolvedValue(null);

    const response = await GET(
      createCronRequest(`Bearer ${process.env.CRON_SECRET}`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Peringatan kapasitas terkirim.",
    });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["admin1@example.com", "admin2@example.com"],
      }),
    );
    expect(mockKvSet).toHaveBeenCalledWith(
      "vaehor:storage-warning-sent",
      expect.any(Number),
    );
  });

  it("returns 500 when no admin emails are configured", async () => {
    delete process.env.ADMIN_EMAILS;
    mockGetStorageDetails.mockResolvedValue({ usage: 95, limit: 100 });
    mockKvGet.mockResolvedValue(null);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      createCronRequest(`Bearer ${process.env.CRON_SECRET}`),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Gagal memproses pemeriksaan penyimpanan.",
    });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
