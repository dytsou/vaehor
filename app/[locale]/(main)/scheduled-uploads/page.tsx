import ScheduledUploads from "@/components/features/ScheduledUploads";

interface ScheduledUploadsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ScheduledUploadsPage({
  searchParams,
}: Readonly<ScheduledUploadsPageProps>) {
  const params = await searchParams;
  const destinationId =
    typeof params.destinationId === "string" ? params.destinationId : "";
  const destinationName =
    typeof params.destinationName === "string" ? params.destinationName : "";

  return (
    <ScheduledUploads
      destinationId={destinationId}
      destinationName={destinationName}
    />
  );
}
