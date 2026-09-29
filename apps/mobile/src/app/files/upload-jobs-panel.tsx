import { Pressable, Text, View } from "react-native";
import { styles } from "./styles";
import type { UploadJob } from "./use-native-upload-queue";

type UploadJobsPanelProps = Readonly<{
  jobs: UploadJob[];
  activeJob: boolean;
  colors: {
    surface: string;
    border: string;
    foreground: string;
    muted: string;
  };
  onCancel: () => void;
  onRetry: (id: string) => void;
}>;

function uploadStatusLabel(job: UploadJob): string {
  if (job.status === "success") return "Uploaded";
  if (job.status === "uploading") return `Uploading ${job.percent}%`;
  return job.errorMessage ?? "";
}

export function UploadJobsPanel({
  jobs,
  activeJob,
  colors,
  onCancel,
  onRetry,
}: UploadJobsPanelProps) {
  if (jobs.length === 0) return null;

  return (
    <View
      style={[
        styles.jobsCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.jobsHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Uploads
        </Text>
        {activeJob ? (
          <Pressable accessibilityRole="button" onPress={onCancel}>
            <Text style={styles.errorAction}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
      {jobs.map((job) => (
        <View key={job.id} style={styles.jobRow}>
          <View style={styles.fileInfo}>
            <Text
              style={[styles.fileName, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {job.fileName}
            </Text>
            <Text style={[styles.fileMeta, { color: colors.muted }]}>
              {uploadStatusLabel(job)}
            </Text>
          </View>
          {job.status === "error" ? (
            <Pressable
              accessibilityRole="button"
              disabled={activeJob}
              onPress={() => onRetry(job.id)}
            >
              <Text style={styles.actionText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}
