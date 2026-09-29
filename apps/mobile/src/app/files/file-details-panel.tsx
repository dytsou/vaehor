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

type FileDetailsPanelProps = Readonly<{
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
}>;

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
  if (!selectedDetails) return null;
  const role = userRole.toUpperCase();
  const canEditTags =
    role === "ADMIN" &&
    Boolean(selectedDetails.id) &&
    !selectedDetails.id?.startsWith("local-storage:");

  return (
    <View
      style={[
        styles.detailCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <FileMetadata
        file={selectedDetails}
        colors={colors}
        fileError={fileError}
        formatSize={formatSize}
      />
      <FileTagsSection
        colors={colors}
        tags={tags}
        tagsLoading={tagsLoading}
        canEditTags={canEditTags}
        working={working}
        tagDraft={tagDraft}
        setTagDraft={setTagDraft}
        handleRemoveTag={handleRemoveTag}
        handleAddTag={handleAddTag}
      />
      <FilePermissionActions
        file={selectedDetails}
        userRole={role}
        favoriteIds={favoriteIds}
        working={working}
        toggleFavorite={toggleFavorite}
        openMovePicker={openMovePicker}
        handleCreateShare={handleCreateShare}
        requestDelete={requestDelete}
      />
      <FileTransferSection
        file={selectedDetails}
        colors={colors}
        working={working}
        downloadPercent={downloadPercent}
        downloadedUri={downloadedUri}
        previewText={previewText}
        previewKind={previewKind}
        serverUrl={serverUrl}
        subtitleFiles={subtitleFiles}
        handleShareDownloaded={handleShareDownloaded}
        handleDownload={handleDownload}
        loadSubtitle={loadSubtitle}
      />
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
  );
}

type FileMetadataProps = Readonly<{
  file: MobileFile;
  colors: FilePanelColors;
  fileError: string | null;
  formatSize: (value: string) => string;
}>;

function FileMetadata({
  file,
  colors,
  fileError,
  formatSize,
}: FileMetadataProps) {
  return (
    <>
      <Text
        style={[styles.detailTitle, { color: colors.foreground }]}
        numberOfLines={2}
      >
        {file.name ?? "File details"}
      </Text>
      <Text style={[styles.fileMeta, { color: colors.muted }]}>
        {file.mimeType ?? "Unknown type"}
      </Text>
      {file.size ? (
        <Text style={[styles.fileMeta, { color: colors.muted }]}>
          {formatSize(file.size)}
        </Text>
      ) : null}
      {fileError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {fileError}
        </Text>
      ) : null}
    </>
  );
}

type FileTagsSectionProps = Readonly<{
  colors: FilePanelColors;
  tags: string[];
  tagsLoading: boolean;
  canEditTags: boolean;
  working: boolean;
  tagDraft: string;
  setTagDraft: (value: string) => void;
  handleRemoveTag: (tag: string) => Promise<void>;
  handleAddTag: () => Promise<void>;
}>;

function FileTagsSection({
  colors,
  tags,
  tagsLoading,
  canEditTags,
  working,
  tagDraft,
  setTagDraft,
  handleRemoveTag,
  handleAddTag,
}: FileTagsSectionProps) {
  return (
    <>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        Tags
      </Text>
      {tagsLoading ? <ActivityIndicator color="#1f6f78" /> : null}
      {!tagsLoading && tags.length === 0 ? (
        <Text style={[styles.fileMeta, { color: colors.muted }]}>No tags</Text>
      ) : null}
      <View style={styles.tagList}>
        {tags.map((tag) => (
          <View
            key={tag}
            style={[
              styles.tagChip,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.fileMeta, { color: colors.foreground }]}>
              {tag}
            </Text>
            {canEditTags ? (
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
      {canEditTags ? (
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
              { color: colors.foreground, borderColor: colors.border },
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
    </>
  );
}

type FilePermissionActionsProps = Readonly<{
  file: MobileFile;
  userRole: string;
  favoriteIds: ReadonlySet<string>;
  working: boolean;
  toggleFavorite: () => Promise<void>;
  openMovePicker: () => void;
  handleCreateShare: () => void;
  requestDelete: () => void;
}>;

function FilePermissionActions({
  file,
  userRole,
  favoriteIds,
  working,
  toggleFavorite,
  openMovePicker,
  handleCreateShare,
  requestDelete,
}: FilePermissionActionsProps) {
  const fileId = file.id;
  const isAdmin = userRole === "ADMIN";
  const canMove =
    ["ADMIN", "EDITOR"].includes(userRole) &&
    Boolean(fileId) &&
    !fileId?.startsWith("local-storage:");
  const favoriteLabel =
    fileId && favoriteIds.has(fileId)
      ? "Remove from favorites"
      : "Add to favorites";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        style={styles.secondaryButton}
        disabled={working || !fileId}
        onPress={() => void toggleFavorite()}
      >
        <Text style={styles.secondaryButtonText}>{favoriteLabel}</Text>
      </Pressable>
      {canMove ? (
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          disabled={working}
          onPress={openMovePicker}
        >
          <Text style={styles.secondaryButtonText}>Move to…</Text>
        </Pressable>
      ) : null}
      {isAdmin ? (
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          disabled={!fileId}
          onPress={handleCreateShare}
        >
          <Text style={styles.secondaryButtonText}>Create share link</Text>
        </Pressable>
      ) : null}
      {isAdmin ? (
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
    </>
  );
}

type FileTransferSectionProps = Readonly<{
  file: MobileFile;
  colors: FilePanelColors;
  working: boolean;
  downloadPercent: number | null;
  downloadedUri: string | null;
  previewText: string | null;
  previewKind: NativePreviewKind;
  serverUrl?: string;
  subtitleFiles: SubtitleFile[];
  handleShareDownloaded: () => Promise<void>;
  handleDownload: () => Promise<void>;
  loadSubtitle: (subtitle: SubtitleFile) => Promise<string>;
}>;

function FileTransferSection({
  file,
  colors,
  working,
  downloadPercent,
  downloadedUri,
  previewText,
  previewKind,
  serverUrl,
  subtitleFiles,
  handleShareDownloaded,
  handleDownload,
  loadSubtitle,
}: FileTransferSectionProps) {
  const resumeKey =
    serverUrl && file.id && previewKind === "video"
      ? createVideoProgressId(serverUrl, file.id)
      : undefined;
  let progressLabel = "Downloading…";
  if (downloadPercent !== null && downloadPercent > 0) {
    progressLabel = `Downloading ${downloadPercent}%`;
  }

  return (
    <>
      {downloadPercent !== null && working ? (
        <Text style={[styles.fileMeta, { color: colors.muted }]}>
          {progressLabel}
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
            key={file.id ?? file.name ?? downloadedUri}
            uri={downloadedUri}
            kind={previewKind}
            text={previewText}
            title={file.name ?? "Audio preview"}
            resumeKey={resumeKey}
            subtitleFiles={subtitleFiles}
            onLoadSubtitle={loadSubtitle}
          />
        </>
      ) : (
        <Pressable
          style={styles.primaryButton}
          disabled={working || file.isFolder}
          onPress={() => void handleDownload()}
        >
          <Text style={styles.primaryButtonText}>
            {working ? "Downloading…" : "Download file"}
          </Text>
        </Pressable>
      )}
    </>
  );
}
