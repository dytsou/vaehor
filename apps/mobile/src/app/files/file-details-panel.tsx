import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { NativePreview } from "../../components/native-preview";
import type { MobileFile } from "../../lib/file-api";
import type { NativePreviewKind } from "../../lib/preview";
import type { SubtitleFile } from "../../lib/subtitles";
import { createVideoProgressId } from "../../lib/video-progress";
import { styles } from "./styles";

type FilePanelColors = {
  foreground: string;
  muted: string;
  surface: string;
  border: string;
};

type FileDetailsPanelProps = {
  selectedDetails: MobileFile | null;
  colors: FilePanelColors;
  fileError: string | null;
  tagsLoading: boolean;
  tags: string[];
  working: boolean;
  userRole: string;
  tagDraft: string;
  setTagDraft: (value: string) => void;
  favoriteIds: ReadonlySet<string>;
  downloadPercent: number | null;
  downloadedUri: string | null;
  previewText: string | null;
  previewKind: NativePreviewKind;
  serverUrl?: string;
  subtitleFiles: SubtitleFile[];
  formatSize: (value: string) => string;
  handleRemoveTag: (tag: string) => Promise<void>;
  handleAddTag: () => Promise<void>;
  toggleFavorite: () => Promise<void>;
  openMovePicker: () => void;
  handleCreateShare: () => void;
  requestDelete: () => void;
  handleShareDownloaded: () => Promise<void>;
  handleDownload: () => Promise<void>;
  loadSubtitle: (subtitle: SubtitleFile) => Promise<string>;
  handleCloseDetails: () => void;
};

export function FileDetailsPanel({
  selectedDetails,
  colors,
  fileError,
  tagsLoading,
  tags,
  working,
  userRole,
  tagDraft,
  setTagDraft,
  favoriteIds,
  downloadPercent,
  downloadedUri,
  previewText,
  previewKind,
  serverUrl,
  subtitleFiles,
  formatSize,
  handleRemoveTag,
  handleAddTag,
  toggleFavorite,
  openMovePicker,
  handleCreateShare,
  requestDelete,
  handleShareDownloaded,
  handleDownload,
  loadSubtitle,
  handleCloseDetails,
}: FileDetailsPanelProps) {
  return (
    <>
      {selectedDetails ? (
        <View
          style={[
            styles.detailCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[styles.detailTitle, { color: colors.foreground }]}
            numberOfLines={2}
          >
            {selectedDetails.name ?? "File details"}
          </Text>
          <Text style={[styles.fileMeta, { color: colors.muted }]}>
            {selectedDetails.mimeType ?? "Unknown type"}
          </Text>
          {selectedDetails.size ? (
            <Text style={[styles.fileMeta, { color: colors.muted }]}>
              {formatSize(selectedDetails.size)}
            </Text>
          ) : null}
          {fileError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {fileError}
            </Text>
          ) : null}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Tags
          </Text>
          {tagsLoading ? <ActivityIndicator color="#1f6f78" /> : null}
          {!tagsLoading && tags.length === 0 ? (
            <Text style={[styles.fileMeta, { color: colors.muted }]}>
              No tags
            </Text>
          ) : null}
          <View style={styles.tagList}>
            {tags.map((tag) => (
              <View
                key={tag}
                style={[
                  styles.tagChip,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.fileMeta, { color: colors.foreground }]}>
                  {tag}
                </Text>
                {userRole.toUpperCase() === "ADMIN" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove tag ${tag}`}
                    disabled={working}
                    onPress={() => void handleRemoveTag(tag)}
                  >
                    <Text style={[styles.actionText, { color: colors.muted }]}>
                      ×
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
          {userRole.toUpperCase() === "ADMIN" &&
          selectedDetails.id &&
          !selectedDetails.id.startsWith("local-storage:") ? (
            <View style={styles.tagInputRow}>
              <TextInput
                accessibilityLabel="Add tag"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={80}
                placeholder="Add a tag"
                placeholderTextColor={colors.muted}
                value={tagDraft}
                onChangeText={setTagDraft}
                onSubmitEditing={() => void handleAddTag()}
                style={[
                  styles.input,
                  styles.tagInput,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                disabled={working || !tagDraft.trim()}
                onPress={() => void handleAddTag()}
                style={[
                  styles.secondaryButton,
                  styles.tagAddButton,
                  (working || !tagDraft.trim()) && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Add</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            disabled={working || !selectedDetails.id}
            onPress={() => void toggleFavorite()}
          >
            <Text style={styles.secondaryButtonText}>
              {selectedDetails.id && favoriteIds.has(selectedDetails.id)
                ? "Remove from favorites"
                : "Add to favorites"}
            </Text>
          </Pressable>
          {["ADMIN", "EDITOR"].includes(userRole.toUpperCase()) &&
          selectedDetails.id &&
          !selectedDetails.id.startsWith("local-storage:") ? (
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              disabled={working}
              onPress={openMovePicker}
            >
              <Text style={styles.secondaryButtonText}>Move to…</Text>
            </Pressable>
          ) : null}
          {userRole.toUpperCase() === "ADMIN" ? (
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              disabled={!selectedDetails.id}
              onPress={handleCreateShare}
            >
              <Text style={styles.secondaryButtonText}>Create share link</Text>
            </Pressable>
          ) : null}
          {userRole.toUpperCase() === "ADMIN" ? (
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              disabled={working}
              onPress={requestDelete}
            >
              <Text style={[styles.secondaryButtonText, { color: "#b42318" }]}>
                Delete
              </Text>
            </Pressable>
          ) : null}
          {downloadPercent !== null && working ? (
            <Text style={[styles.fileMeta, { color: colors.muted }]}>
              {downloadPercent === 0
                ? "Downloading…"
                : `Downloading ${downloadPercent}%`}
            </Text>
          ) : null}
          {downloadedUri ? (
            <>
              <View style={styles.buttonRow}>
                <Text style={styles.success}>Downloaded to this device</Text>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void handleShareDownloaded()}
                >
                  <Text style={styles.secondaryButtonText}>Save or share…</Text>
                </Pressable>
              </View>
              <NativePreview
                key={
                  selectedDetails.id ?? selectedDetails.name ?? downloadedUri
                }
                uri={downloadedUri}
                kind={previewKind}
                text={previewText}
                title={selectedDetails.name ?? "Audio preview"}
                resumeKey={
                  serverUrl && selectedDetails.id && previewKind === "video"
                    ? createVideoProgressId(serverUrl, selectedDetails.id)
                    : undefined
                }
                subtitleFiles={subtitleFiles}
                onLoadSubtitle={loadSubtitle}
              />
            </>
          ) : (
            <Pressable
              style={styles.primaryButton}
              disabled={working || selectedDetails.isFolder}
              onPress={() => void handleDownload()}
            >
              <Text style={styles.primaryButtonText}>
                {working ? "Downloading…" : "Download file"}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            style={styles.closeButton}
            onPress={handleCloseDetails}
          >
            <Text style={[styles.actionText, { color: colors.muted }]}>
              Close details
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
