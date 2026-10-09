export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createUserRoute } from "@/lib/api-middleware";
import { getStorageDetails } from "@/lib/drive";
import { isAccessRestricted } from "@/lib/securityUtils";

export const GET = createUserRoute(async ({ session }) => {
  try {
    const details = await getStorageDetails();
    const isAdmin = session.user?.role === "ADMIN";

    if (!isAdmin) {
      const restrictions = await Promise.all(
        details.largestFiles.map((file) => isAccessRestricted(file.id)),
      );
      details.largestFiles = details.largestFiles.filter(
        (_, index) => !restrictions[index],
      );
    }

    return NextResponse.json(details);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Terjadi kesalahan tidak dikenal.";
    console.error("Storage Details API Error:", errorMessage);
    return NextResponse.json(
      { error: "Gagal mengambil detail penyimpanan.", details: errorMessage },
      { status: 500 },
    );
  }
});
