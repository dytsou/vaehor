import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Shipped under `packages/mcp/messages/` — bundled with npm package for standalone publish. */
export type McpLocale = "en" | "id" | "zh-TW";

const LOCALES: readonly McpLocale[] = ["en", "id", "zh-TW"];

export type McpToolKey =
  | "zee_health"
  | "zee_public_config"
  | "zee_metadata_lookup"
  | "zee_whoami"
  | "zee_files_list"
  | "zee_search"
  | "zee_search_global";

export type McpSchemaKey =
  | "filename"
  | "folderId"
  | "pageToken"
  | "refresh"
  | "q"
  | "folderIdSearch"
  | "searchType"
  | "mimeType"
  | "modifiedTime"
  | "minSize"
  | "qGlobal";

export interface McpMessages {
  missingSession: string;
  searchNeedOneCriterion: string;
  tools: Record<McpToolKey, { title: string; description: string }>;
  schema: Record<McpSchemaKey, string>;
}

export function resolveMcpLocale(raw: string | undefined): McpLocale {
  const v = raw?.trim();
  if (v && (LOCALES as readonly string[]).includes(v)) {
    return v as McpLocale;
  }
  return "en";
}

/** Package root (`packages/mcp`): resolves from `dist/*.js` or `src/*.ts` when using tsx. */
function getPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function getMessagesJsonPath(locale: string): string {
  return path.join(getPackageRoot(), "messages", `${locale}.json`);
}

export function loadMcpMessages(locale: McpLocale): McpMessages {
  const raw = readFileSync(getMessagesJsonPath(locale), "utf8");
  return JSON.parse(raw) as McpMessages;
}
