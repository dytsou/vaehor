import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZEE_MOBILE_MESSAGE } from "@vaehor/mobile-bridge-protocol";
import { attachUploadBridge } from "../src/plugins/upload-bridge";

const nativeMocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
  readdir: vi.fn(),
  convertFileSrc: vi.fn(),
}));

vi.mock("@capawesome/capacitor-file-picker", () => ({
  FilePicker: { pickDirectory: nativeMocks.pickDirectory },
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { readdir: nativeMocks.readdir },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { convertFileSrc: nativeMocks.convertFileSrc },
}));

vi.mock("../src/lib/background-upload", () => ({
  runWithBackgroundUploadSupport: (work: () => Promise<unknown>) => work(),
}));

const origin = "https://files.example.com";
const schedulePath = `${origin}/api/scheduled-uploads`;
const rootPath = "content://provider/tree/primary%3ADocuments%2FRelease";
const notesPath = "content://provider/tree/release/notes";
const briefPath = "content://provider/document/brief.txt";
const coverPath = "content://provider/document/cover.jpg";

type DirectoryEntry = {
  name: string;
  type: "file" | "directory";
  size: number;
  uri: string;
};

let stopBridge: (() => void) | undefined;

function configureNativeDirectory() {
  nativeMocks.pickDirectory.mockResolvedValue({ path: rootPath });
  nativeMocks.readdir.mockImplementation(async ({ path }: { path: string }) => {
    const entries: Record<string, DirectoryEntry[]> = {
      [rootPath]: [
        { name: "cover.jpg", type: "file", size: 3, uri: coverPath },
        { name: "notes", type: "directory", size: 0, uri: notesPath },
      ],
      [notesPath]: [
        { name: "brief.txt", type: "file", size: 5, uri: briefPath },
      ],
    };
    return { files: entries[path] ?? [] };
  });
  nativeMocks.convertFileSrc.mockImplementation(
    (path: string) => `webview-file://${path}`,
  );
}

function createFrame() {
  const iframe = document.createElement("iframe");
  const postedMessages: Array<{ message: unknown; targetOrigin: string }> = [];
  const childWindow = {
    postMessage: vi.fn((message: unknown, targetOrigin: string) => {
      postedMessages.push({ message, targetOrigin });
    }),
  } as unknown as Window;
  vi.spyOn(iframe, "contentWindow", "get").mockReturnValue(childWindow);
  const onProgress = vi.fn();
  stopBridge = attachUploadBridge({
    origin,
    sessionToken: "session-token",
    iframe,
    onProgress,
  });
  return { childWindow, postedMessages, onProgress };
}

function sendScheduledRequest(
  childWindow: Window,
  options:
    | {
        mode: "create";
        destinationId: string;
        scheduledLocalTime: string;
        timeZone: string;
        utcOffset: string;
      }
    | { mode: "resume"; scheduleId: string },
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: ZEE_MOBILE_MESSAGE,
        action: "scheduled/pick-folder",
        requestId: "scheduled-request-1",
        ...options,
      },
      source: childWindow,
      origin,
    }),
  );
}

function getPostedMessages(
  postedMessages: Array<{ message: unknown; targetOrigin: string }>,
) {
  return postedMessages.map(({ message }) => message as { action: string });
}

async function waitForPostedAction(
  postedMessages: Array<{ message: unknown; targetOrigin: string }>,
  action: string,
) {
  await vi.waitFor(() => {
    expect(
      getPostedMessages(postedMessages).some(
        (message) => message.action === action,
      ),
    ).toBe(true);
  });
  return getPostedMessages(postedMessages).find(
    (message) => message.action === action,
  );
}

function installFetchMock(
  responseFor: (
    url: string,
    init: RequestInit | undefined,
  ) => Promise<Response>,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    responseFor(String(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  nativeMocks.pickDirectory.mockReset();
  nativeMocks.readdir.mockReset();
  nativeMocks.convertFileSrc.mockReset();
  configureNativeDirectory();
});

afterEach(() => {
  stopBridge?.();
  stopBridge = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scheduled upload native bridge", () => {
  it("scans a native folder, stages its files privately, and commits the package", async () => {
    let manifest: Array<{
      path: string;
      kind: "file" | "folder";
      size: number;
      contentType?: string;
    }> = [];
    const stagedPaths: string[] = [];
    const fetchMock = installFetchMock(async (url, init) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("webview-file://")) {
        return new Response(url.endsWith("brief.txt") ? "hello" : "hey");
      }
      if (url === schedulePath && method === "GET") {
        return Response.json({
          limits: {
            maxFileBytes: "100",
            maxPackageBytes: "200",
            maxItems: 10,
          },
        });
      }
      if (url === schedulePath && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          items: typeof manifest;
        };
        manifest = body.items;
        return Response.json(
          {
            schedule: {
              id: "schedule-1",
              status: "STAGING",
              totalBytes: "8",
              items: manifest.map((item, index) => ({
                id: `item-${index}`,
                path: item.path,
                kind: item.kind === "file" ? "FILE" : "FOLDER",
                size: String(item.size),
                status: "PENDING",
              })),
            },
          },
          { status: 201 },
        );
      }
      if (url.includes("/items/") && method === "PUT") {
        stagedPaths.push(url);
        return Response.json({ item: { status: "STAGED" } });
      }
      if (url.endsWith("/commit") && method === "POST") {
        return Response.json({ schedule: { id: "schedule-1" } });
      }
      return Response.json(
        { error: `Unexpected request: ${method} ${url}` },
        { status: 404 },
      );
    });

    const { childWindow, postedMessages, onProgress } = createFrame();
    sendScheduledRequest(childWindow, {
      mode: "create",
      destinationId: "drive-folder-1",
      scheduledLocalTime: "2026-10-01T09:30",
      timeZone: "Asia/Taipei",
      utcOffset: "+08:00",
    });

    const done = await waitForPostedAction(postedMessages, "scheduled/done");
    expect(done).toMatchObject({
      requestId: "scheduled-request-1",
      scheduleId: "schedule-1",
    });
    expect(manifest).toEqual([
      { path: "Release", kind: "folder", size: 0 },
      { path: "Release/notes", kind: "folder", size: 0 },
      {
        path: "Release/cover.jpg",
        kind: "file",
        size: 3,
        contentType: "image/jpeg",
      },
      {
        path: "Release/notes/brief.txt",
        kind: "file",
        size: 5,
        contentType: "text/plain",
      },
    ]);
    expect(stagedPaths).toHaveLength(2);
    expect(
      postedMessages.some(
        ({ message }) =>
          (message as { action?: string }).action === "scheduled/progress",
      ),
    ).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "Release/cover.jpg",
        status: "success",
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeDefined();
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(firstHeaders.get("Cookie")).toBe(
      "authjs.session-token=session-token",
    );
  });

  it("resumes a staged folder by uploading only files that are not staged yet", async () => {
    const stagedPaths: string[] = [];
    installFetchMock(async (url, init) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("webview-file://")) {
        return new Response(url.endsWith("cover.jpg") ? "hey" : "hello");
      }
      if (url === `${schedulePath}/schedule-1` && method === "GET") {
        return Response.json({
          schedule: {
            id: "schedule-1",
            status: "STAGING",
            totalBytes: "8",
            items: [
              {
                id: "folder-1",
                path: "Release",
                kind: "FOLDER",
                size: "0",
                status: "PENDING",
              },
              {
                id: "folder-2",
                path: "Release/notes",
                kind: "FOLDER",
                size: "0",
                status: "PENDING",
              },
              {
                id: "cover",
                path: "Release/cover.jpg",
                kind: "FILE",
                size: "3",
                status: "PENDING",
              },
              {
                id: "brief",
                path: "Release/notes/brief.txt",
                kind: "FILE",
                size: "5",
                status: "STAGED",
              },
            ],
          },
        });
      }
      if (url.includes("/items/") && method === "PUT") {
        stagedPaths.push(url);
        return Response.json({ item: { status: "STAGED" } });
      }
      if (url.endsWith("/commit") && method === "POST") {
        return Response.json({ schedule: { id: "schedule-1" } });
      }
      return Response.json(
        { error: `Unexpected request: ${method} ${url}` },
        { status: 404 },
      );
    });

    const { childWindow, postedMessages } = createFrame();
    sendScheduledRequest(childWindow, {
      mode: "resume",
      scheduleId: "schedule-1",
    });

    const done = await waitForPostedAction(postedMessages, "scheduled/done");
    expect(done).toMatchObject({ scheduleId: "schedule-1" });
    expect(stagedPaths).toHaveLength(1);
    expect(stagedPaths[0]).toContain("/items/cover/content");
    expect(stagedPaths[0]).not.toContain("/items/brief/content");
  });
});
