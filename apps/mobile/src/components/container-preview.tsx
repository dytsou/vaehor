import { File as ExpoFile } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  DocumentPreviewError,
  loadDocumentPreview,
  MAX_CONTAINER_PREVIEW_BYTES,
  type DocumentPreview,
  type DocumentPreviewKind,
} from "../lib/document-preview";
import { formatMobileFileSize } from "../lib/mobile-formatters";

type Props = {
  kind: DocumentPreviewKind;
  title: string;
  uri: string;
};

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: DocumentPreview };

function safeLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "�").slice(0, 240);
}

function errorMessage(cause: unknown): string {
  return cause instanceof DocumentPreviewError
    ? cause.message
    : "This file could not be safely previewed. Try downloading it again.";
}

export function ContainerPreview({ kind, title, uri }: Props) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [entryText, setEntryText] = useState<string | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const entryRequestRef = useRef(0);

  useEffect(() => {
    let active = true;
    entryRequestRef.current += 1;
    setState({ status: "loading" });
    setSelectedEntry(null);
    setEntryText(null);
    setEntryLoading(false);
    setSelectedChapter(null);

    void (async () => {
      try {
        const file = new ExpoFile(uri);
        if (file.size > MAX_CONTAINER_PREVIEW_BYTES) {
          throw new DocumentPreviewError("file_too_large");
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength > MAX_CONTAINER_PREVIEW_BYTES) {
          throw new DocumentPreviewError("file_too_large");
        }
        const preview = await loadDocumentPreview(bytes, kind, title);
        if (!active) return;
        setState({ status: "ready", preview });
      } catch (cause) {
        if (active) setState({ status: "error", message: errorMessage(cause) });
      }
    })();

    return () => {
      active = false;
      entryRequestRef.current += 1;
    };
  }, [kind, title, uri]);

  const chooseEntry = async (path: string) => {
    if (state.status !== "ready" || state.preview.type !== "archive") return;
    const requestId = ++entryRequestRef.current;
    setSelectedEntry(path);
    setEntryText(null);
    setEntryLoading(true);
    try {
      const text = await state.preview.readTextEntry(path);
      if (entryRequestRef.current === requestId) setEntryText(text);
    } catch (cause) {
      if (entryRequestRef.current === requestId) {
        setEntryText(errorMessage(cause));
      }
    } finally {
      if (entryRequestRef.current === requestId) setEntryLoading(false);
    }
  };

  if (state.status === "loading") {
    return (
      <View style={styles.status}>
        <ActivityIndicator color="#1f6f78" />
        <Text style={styles.statusText}>Preparing a safe in-app preview…</Text>
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.status}>
        <Text accessibilityRole="alert" style={styles.errorTitle}>
          Preview unavailable
        </Text>
        <Text style={styles.statusText}>{state.message}</Text>
      </View>
    );
  }

  if (state.preview.type === "text") {
    return (
      <ScrollView style={styles.textContainer} nestedScrollEnabled>
        <Text selectable style={styles.documentText}>
          {state.preview.text}
        </Text>
      </ScrollView>
    );
  }

  if (state.preview.type === "epub") {
    const chapter =
      state.preview.chapters.find((item) => item.id === selectedChapter) ??
      state.preview.chapters[0];
    return (
      <View style={styles.document}>
        <Text style={styles.documentTitle} numberOfLines={2}>
          {state.preview.title || title}
        </Text>
        <ScrollView
          horizontal
          contentContainerStyle={styles.chapterList}
          showsHorizontalScrollIndicator={false}
        >
          {state.preview.chapters.map((item) => {
            const selected = item.id === chapter?.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSelectedChapter(item.id)}
                style={[
                  styles.chapterButton,
                  selected && styles.chapterSelected,
                ]}
              >
                <Text
                  style={[
                    styles.chapterButtonText,
                    selected && styles.chapterSelectedText,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView style={styles.chapterTextContainer} nestedScrollEnabled>
          <Text selectable style={styles.documentText}>
            {chapter?.text ?? "No readable chapter content was found."}
          </Text>
        </ScrollView>
      </View>
    );
  }

  if (selectedEntry !== null) {
    return (
      <View style={styles.document}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            entryRequestRef.current += 1;
            setSelectedEntry(null);
            setEntryText(null);
            setEntryLoading(false);
          }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>‹ Archive entries</Text>
        </Pressable>
        <Text style={styles.documentTitle} numberOfLines={2}>
          {safeLabel(selectedEntry)}
        </Text>
        {entryLoading ? (
          <ActivityIndicator color="#1f6f78" />
        ) : (
          <ScrollView style={styles.chapterTextContainer} nestedScrollEnabled>
            <Text selectable style={styles.documentText}>
              {entryText ?? "No text content is available for this entry."}
            </Text>
          </ScrollView>
        )}
      </View>
    );
  }

  const entries = state.preview.entries;
  return (
    <View style={styles.document}>
      <Text style={styles.documentTitle}>{entries.length} archive items</Text>
      {entries.length ? (
        <ScrollView style={styles.entryList} nestedScrollEnabled>
          {entries.map((entry) => (
            <Pressable
              key={entry.path}
              accessibilityRole="button"
              accessibilityState={{ disabled: !entry.canPreviewText }}
              disabled={!entry.canPreviewText}
              onPress={() => void chooseEntry(entry.path)}
              style={styles.entryRow}
            >
              <View style={styles.entryBody}>
                <Text style={styles.entryPath} numberOfLines={1}>
                  {safeLabel(entry.path)}
                </Text>
                {!entry.isFolder && !entry.canPreviewText ? (
                  <Text style={styles.entryHint}>
                    Text preview is available for supported files up to 512 KB.
                  </Text>
                ) : null}
              </View>
              {!entry.isFolder ? (
                <Text style={styles.entrySize}>
                  {formatMobileFileSize(entry.size)}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.statusText}>This archive contains no items.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  document: {
    backgroundColor: "#101719",
    borderRadius: 10,
    gap: 8,
    maxHeight: 360,
    padding: 12,
  },
  documentTitle: {
    color: "#d8e8e8",
    fontSize: 14,
    fontWeight: "700",
  },
  textContainer: {
    backgroundColor: "#101719",
    borderRadius: 10,
    maxHeight: 300,
    padding: 12,
  },
  chapterList: {
    gap: 8,
    paddingVertical: 2,
  },
  chapterButton: {
    borderColor: "#527075",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chapterSelected: {
    backgroundColor: "#1f6f78",
    borderColor: "#1f6f78",
  },
  chapterButtonText: {
    color: "#d8e8e8",
    fontSize: 12,
  },
  chapterSelectedText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  chapterTextContainer: {
    maxHeight: 270,
  },
  documentText: {
    color: "#d8e8e8",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  entryList: {
    maxHeight: 310,
  },
  entryRow: {
    alignItems: "center",
    borderBottomColor: "#294247",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 9,
  },
  entryBody: {
    flex: 1,
    gap: 3,
  },
  entryPath: {
    color: "#d8e8e8",
    fontSize: 12,
  },
  entryHint: {
    color: "#8ba9ad",
    fontSize: 10,
  },
  entrySize: {
    color: "#8ba9ad",
    fontSize: 10,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 3,
  },
  backButtonText: {
    color: "#7cc2ca",
    fontSize: 12,
    fontWeight: "700",
  },
  status: {
    alignItems: "center",
    backgroundColor: "#eef2f3",
    borderRadius: 10,
    gap: 8,
    padding: 16,
  },
  statusText: {
    color: "#45666a",
    textAlign: "center",
  },
  errorTitle: {
    color: "#8d2e34",
    fontWeight: "700",
  },
});
