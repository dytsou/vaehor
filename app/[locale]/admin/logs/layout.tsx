import MainLayout from "@/app/[locale]/(main)/layout";

export const metadata = {
  title: "Log Aktivitas - Admin vaehor",
  description: "Lihat dan kelola log aktivitas sistem.",
};

export default function LogsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayout>{children}</MainLayout>;
}
