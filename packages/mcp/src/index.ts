#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  loadMcpMessages,
  resolveMcpLocale,
  type McpMessages,
} from "./messages-loader.js";

const DEFAULT_BASE = "http://127.0.0.1:3000";
const SESSION_COOKIE_NAME = "authjs.session-token";

const msgs: McpMessages = loadMcpMessages(
  resolveMcpLocale(process.env.VAEHOR_LOCALE),
);

function getBaseUrl(): string {
  const raw = process.env.VAEHOR_BASE_URL?.trim();
  if (!raw) return DEFAULT_BASE;
  return raw.replace(/\/$/, "");
}

/** Cookie header value for NextAuth session (never log this). */
function getSessionCookieHeader(): string | null {
  const full = process.env.VAEHOR_SESSION_COOKIE?.trim();
  if (full) return full;

  const tokenOnly = process.env.VAEHOR_SESSION_TOKEN?.trim();
  if (tokenOnly) return `${SESSION_COOKIE_NAME}=${tokenOnly}`;

  return null;
}

type AuthMode = "none" | "required";

async function fetchJson(
  path: string,
  options: { auth?: AuthMode; init?: RequestInit } = {},
): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
  authMissing?: boolean;
}> {
  const auth = options.auth ?? "none";

  if (auth === "required" && !getSessionCookieHeader()) {
    return {
      ok: false,
      status: 401,
      body: { error: "Unauthorized", message: msgs.missingSession },
      authMissing: true,
    };
  }

  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30_000);
  const cookie = getSessionCookieHeader();

  try {
    const res = await fetch(url, {
      ...options.init,
      signal: ac.signal,
      headers: {
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...options.init?.headers,
      },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

function textResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

const server = new McpServer({
  name: "vaehor",
  version: "0.1.0",
});

const t = msgs.tools;

server.registerTool(
  "zee_health",
  {
    title: t.zee_health.title,
    description: t.zee_health.description,
    inputSchema: z.object({}).strict(),
  },
  async () => {
    const { ok, status, body } = await fetchJson("/api/health", {
      auth: "none",
    });
    return {
      ...textResult({ ok, status, data: body }),
      isError: !ok,
    };
  },
);

server.registerTool(
  "zee_public_config",
  {
    title: t.zee_public_config.title,
    description: t.zee_public_config.description,
    inputSchema: z.object({}).strict(),
  },
  async () => {
    const { ok, status, body } = await fetchJson("/api/config/public", {
      auth: "none",
    });
    return {
      ...textResult({ ok, status, data: body }),
      isError: !ok,
    };
  },
);

server.registerTool(
  "zee_metadata_lookup",
  {
    title: t.zee_metadata_lookup.title,
    description: t.zee_metadata_lookup.description,
    inputSchema: z
      .object({
        filename: z.string().min(1).describe(msgs.schema.filename),
      })
      .strict(),
  },
  async ({ filename }) => {
    const q = new URLSearchParams({ filename });
    const { ok, status, body } = await fetchJson(
      `/api/metadata?${q.toString()}`,
      { auth: "none" },
    );
    return {
      ...textResult({ ok, status, data: body }),
      isError: !ok,
    };
  },
);

server.registerTool(
  "zee_whoami",
  {
    title: t.zee_whoami.title,
    description: t.zee_whoami.description,
    inputSchema: z.object({}).strict(),
  },
  async () => {
    const { ok, status, body, authMissing } = await fetchJson("/api/auth/me", {
      auth: "required",
    });
    return {
      ...textResult({
        ok,
        status,
        data: body,
        ...(authMissing ? { hint: msgs.missingSession } : {}),
      }),
      isError: !ok,
    };
  },
);

const s = msgs.schema;
const filesListSchema = z
  .object({
    folderId: z.string().optional().describe(s.folderId),
    pageToken: z.string().optional().describe(s.pageToken),
    refresh: z.boolean().optional().describe(s.refresh),
  })
  .strict();

server.registerTool(
  "zee_files_list",
  {
    title: t.zee_files_list.title,
    description: t.zee_files_list.description,
    inputSchema: filesListSchema,
  },
  async (input) => {
    const q = new URLSearchParams();
    if (input.folderId) q.set("folderId", input.folderId);
    if (input.pageToken) q.set("pageToken", input.pageToken);
    if (input.refresh === true) q.set("refresh", "true");
    const query = q.toString();
    const path = query ? `/api/files?${query}` : "/api/files";
    const { ok, status, body, authMissing } = await fetchJson(path, {
      auth: "required",
    });
    return {
      ...textResult({
        ok,
        status,
        data: body,
        ...(authMissing ? { hint: msgs.missingSession } : {}),
      }),
      isError: !ok,
    };
  },
);

const searchFolderSchema = z
  .object({
    q: z.string().optional().describe(s.q),
    folderId: z.string().optional().describe(s.folderIdSearch),
    searchType: z.enum(["name", "fullText"]).optional().describe(s.searchType),
    mimeType: z
      .enum(["image", "video", "audio", "pdf", "folder"])
      .optional()
      .describe(s.mimeType),
    modifiedTime: z
      .enum(["today", "week", "month"])
      .optional()
      .describe(s.modifiedTime),
    minSize: z.string().optional().describe(s.minSize),
  })
  .strict()
  .refine(
    (v) => !!(v.q?.trim() || v.mimeType || v.modifiedTime || v.minSize?.trim()),
    { message: msgs.searchNeedOneCriterion },
  );

server.registerTool(
  "zee_search",
  {
    title: t.zee_search.title,
    description: t.zee_search.description,
    inputSchema: searchFolderSchema,
  },
  async (input) => {
    const q = new URLSearchParams();
    if (input.q?.trim()) q.set("q", input.q.trim());
    if (input.folderId) q.set("folderId", input.folderId);
    if (input.searchType) q.set("searchType", input.searchType);
    if (input.mimeType) q.set("mimeType", input.mimeType);
    if (input.modifiedTime) q.set("modifiedTime", input.modifiedTime);
    if (input.minSize?.trim()) q.set("minSize", input.minSize.trim());

    const { ok, status, body, authMissing } = await fetchJson(
      `/api/search?${q.toString()}`,
      { auth: "required" },
    );
    return {
      ...textResult({
        ok,
        status,
        data: body,
        ...(authMissing ? { hint: msgs.missingSession } : {}),
      }),
      isError: !ok,
    };
  },
);

const searchGlobalSchema = z
  .object({
    q: z.string().min(1).describe(s.qGlobal),
    searchType: z.enum(["name", "fullText"]).optional().describe(s.searchType),
    mimeType: z
      .enum(["image", "video", "audio", "pdf", "folder"])
      .optional()
      .describe(s.mimeType),
    modifiedTime: z
      .enum(["today", "week", "month"])
      .optional()
      .describe(s.modifiedTime),
  })
  .strict();

server.registerTool(
  "zee_search_global",
  {
    title: t.zee_search_global.title,
    description: t.zee_search_global.description,
    inputSchema: searchGlobalSchema,
  },
  async (input) => {
    const q = new URLSearchParams();
    q.set("q", input.q);
    if (input.searchType) q.set("searchType", input.searchType);
    if (input.mimeType) q.set("mimeType", input.mimeType);
    if (input.modifiedTime) q.set("modifiedTime", input.modifiedTime);

    const { ok, status, body, authMissing } = await fetchJson(
      `/api/search/global?${q.toString()}`,
      { auth: "required" },
    );
    return {
      ...textResult({
        ok,
        status,
        data: body,
        ...(authMissing ? { hint: msgs.missingSession } : {}),
      }),
      isError: !ok,
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
