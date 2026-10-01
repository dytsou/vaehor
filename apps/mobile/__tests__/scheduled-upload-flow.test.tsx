import {
  fireEvent as domFireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScheduledUploadStatus,
  type ScheduledUpload,
  type ScheduledUploadSummary,
} from "@vaehor/sdk";
import {
  ScheduledUploadsScreen,
  type ScheduledUploadDrive,
} from "../src/app/scheduled-uploads";
import type { ScheduledUploadApi } from "../src/lib/scheduled-upload-api";
import type { NativeScheduledUploadSelection } from "../src/lib/native-upload-file";

vi.mock("expo-router", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

vi.mock("react-native", async () => {
  const React = await import("react");
  const host =
    (element: string) =>
    ({
      accessibilityLabel,
      accessibilityRole,
      children,
      onPress,
      style: _style,
      testID,
      ...props
    }: Record<string, any>) =>
      React.createElement(
        element,
        {
          ...props,
          "aria-label": accessibilityLabel,
          "data-testid": testID,
          onClick: onPress,
          role: accessibilityRole,
        },
        children,
      );
  const TextInput = ({
    accessibilityLabel,
    onChangeText,
    style: _style,
    testID,
    ...props
  }: Record<string, any>) =>
    React.createElement("input", {
      ...props,
      "aria-label": accessibilityLabel,
      "data-testid": testID,
      onChange: (event: { target: { value: string } }) =>
        onChangeText?.(event.target.value),
    });

  return {
    ActivityIndicator: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1 },
    Text: host("span"),
    TextInput,
    View: host("div"),
  };
});

vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement("main", null, children),
  };
});

vi.mock("../src/app/route-session", () => ({
  loadActiveRouteSession: vi.fn(),
}));

vi.mock("../src/lib/file-api", () => ({ listMobileDrives: vi.fn() }));

vi.mock("../src/lib/mobile-preferences", () => ({
  useMobilePreferences: () => ({ locale: "en", theme: "light" }),
}));

vi.mock("../src/lib/native-upload-file", () => ({
  pickScheduledUploadDirectory: vi.fn(async () => null),
  pickScheduledUploadFiles: vi.fn(async () => null),
}));

const fireEvent = {
  press: (element: Element) => domFireEvent.click(element),
};

afterEach(() => {
  vi.clearAllMocks();
});

const baseSchedule = (
  status: ScheduledUpload["status"],
  itemStatus: ScheduledUpload["items"][number]["status"] = "PENDING",
): ScheduledUpload => ({
  id: "schedule-1",
  creatorEmail: "editor@example.test",
  destinationId: "drive-root",
  scheduledAt: "2030-01-02T02:00:00.000Z",
  scheduledLocalTime: "2030-01-02T10:00",
  timeZone: "Asia/Taipei",
  utcOffset: "+08:00",
  status,
  itemCount: 1,
  totalBytes: "4",
  stagedBytes: status === ScheduledUploadStatus.WAITING ? "4" : "0",
  stageCompleteAt:
    status === ScheduledUploadStatus.WAITING ? "2030-01-01T00:00:00Z" : null,
  firstWriteAt: null,
  retryAfter: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  cleanupStatus: "PENDING",
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  items: [
    {
      id: "item-1",
      path: "reports/summary.txt",
      kind: "FILE",
      size: "4",
      uploadedBytes: "0",
      status: itemStatus,
      contentType: "text/plain",
      stagedAt: null,
    },
  ],
});

const uploadLimits = {
  maxFileBytes: "1024",
  maxPackageBytes: "4096",
  maxItems: 10,
  reserveFreeBytes: "0",
};

function toSummary(schedule: ScheduledUpload): ScheduledUploadSummary {
  const { items, ...summary } = schedule;
  const uploadedBytes = items
    .filter((item) => item.kind === "FILE")
    .reduce((total, item) => total + BigInt(item.uploadedBytes), 0n);
  return { ...summary, uploadedBytes: uploadedBytes.toString() };
}

function schedulePage(...schedules: ScheduledUpload[]) {
  return {
    items: schedules.map(toSummary),
    nextCursor: null,
    limits: uploadLimits,
  };
}

const drives: ScheduledUploadDrive[] = [
  {
    id: "drive-1",
    name: "Team Drive",
    rootFolderId: "drive-root",
    isProtected: false,
  },
];

function createApi(overrides: Partial<ScheduledUploadApi> = {}) {
  return {
    list: vi.fn(async () => schedulePage()),
    get: vi.fn(async () => ({ schedule: baseSchedule("STAGING") })),
    listAdminAlerts: vi.fn(async () => ({ alerts: [] })),
    create: vi.fn(async () => ({
      schedule: baseSchedule("STAGING"),
      limits: {},
    })),
    stage: vi.fn(async () => ({ item: { id: "item-1", status: "STAGED" } })),
    commit: vi.fn(async () => ({
      schedule: baseSchedule("WAITING", "STAGED"),
    })),
    updateTime: vi.fn(async () => ({
      schedule: baseSchedule("WAITING", "STAGED"),
    })),
    cancel: vi.fn(async () => ({
      schedule: baseSchedule("CANCELED", "STAGED"),
    })),
    retry: vi.fn(async () => ({
      schedule: baseSchedule("RELEASING", "UPLOADING"),
    })),
    abandon: vi.fn(async () => ({
      schedule: baseSchedule("ABANDONED", "STAGED"),
    })),
    acknowledgeAdminAlert: vi.fn(async () => ({ alert: {} })),
    cancelAsAdmin: vi.fn(async () => ({ schedule: baseSchedule("CANCELED") })),
    ...overrides,
  } as unknown as ScheduledUploadApi;
}

function createSelection(): NativeScheduledUploadSelection {
  return {
    entries: [
      {
        path: "reports/summary.txt",
        kind: "file",
        size: 4,
        contentType: "text/plain",
        file: {
          name: "summary.txt",
          mimeType: "text/plain",
          size: 4,
          readChunk: vi.fn(async (_start, end) => new Uint8Array(end).fill(1)),
          close: vi.fn(),
        },
      },
    ],
    release: vi.fn(),
  };
}

describe("mobile scheduled upload flow", () => {
  it("stages selected content to Waiting and later renders refreshed server progress", async () => {
    const schedule = baseSchedule("WAITING", "STAGED");
    const api = createApi({
      list: vi
        .fn()
        .mockResolvedValueOnce(schedulePage())
        .mockResolvedValueOnce(schedulePage(schedule)),
    });
    const selection = createSelection();
    const picker = {
      pickFiles: vi.fn(async () => selection),
      pickDirectory: vi.fn(async () => selection),
    };

    render(
      <ScheduledUploadsScreen
        api={api}
        role="EDITOR"
        drives={drives}
        picker={picker}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("No scheduled uploads yet.")).toBeTruthy(),
    );

    fireEvent.press(
      screen.getByRole("button", { name: "New scheduled upload" }),
    );
    fireEvent.press(screen.getByRole("button", { name: "Add files" }));
    await waitFor(() =>
      expect(screen.getByText("reports/summary.txt")).toBeTruthy(),
    );
    fireEvent.press(screen.getByRole("button", { name: "Stage and schedule" }));

    await waitFor(() => expect(api.commit).toHaveBeenCalledWith("schedule-1"));
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationId: "drive-root",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        items: [
          expect.objectContaining({
            path: "reports/summary.txt",
            kind: "file",
            size: 4,
            contentType: "text/plain",
          }),
        ],
      }),
    );
    expect(api.stage).toHaveBeenCalledWith(
      "schedule-1",
      "item-1",
      expect.any(Blob),
    );
    expect(selection.release).toHaveBeenCalledOnce();
    expect(await screen.findAllByText("Waiting")).toHaveLength(2);

    const releasingSchedule = {
      ...baseSchedule("RELEASING", "UPLOADING"),
      firstWriteAt: "2030-01-02T02:00:01.000Z",
      items: [
        {
          ...baseSchedule("RELEASING", "UPLOADING").items[0],
          uploadedBytes: "2",
        },
      ],
    };
    vi.mocked(api.list).mockResolvedValueOnce({
      ...schedulePage(releasingSchedule),
    });
    fireEvent.press(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Writing to Drive")).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "SPAN" &&
          element.textContent?.includes("2 / 4 bytes") === true &&
          element.textContent.includes("uploaded"),
      ),
    ).toBeTruthy();
  });

  it("does not request schedules for a normal user", async () => {
    const api = createApi();

    render(<ScheduledUploadsScreen api={api} role="USER" drives={drives} />);

    expect(
      await screen.findByText("Editor or admin access is required."),
    ).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("keeps owner and admin empty states distinct", async () => {
    const ownerApi = createApi();
    const owner = render(
      <ScheduledUploadsScreen api={ownerApi} role="EDITOR" drives={drives} />,
    );
    expect(await screen.findByText("No scheduled uploads yet.")).toBeTruthy();

    owner.unmount();
    const adminApi = createApi();
    render(
      <ScheduledUploadsScreen api={adminApi} role="ADMIN" drives={drives} />,
    );
    expect(
      await screen.findByText("No schedules need attention."),
    ).toBeTruthy();
  });

  it("fetches a schedule manifest only after the owner opens its items", async () => {
    const schedule = baseSchedule("WAITING", "STAGED");
    const api = createApi({ list: vi.fn(async () => schedulePage(schedule)) });

    render(<ScheduledUploadsScreen api={api} role="EDITOR" drives={drives} />);
    await screen.findByText("Waiting");
    expect(screen.queryByText("reports/summary.txt")).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: "View items" }));

    expect(await screen.findByText("reports/summary.txt")).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("schedule-1");
  });

  it("loads older schedule summaries with a cursor", async () => {
    const first = baseSchedule("WAITING", "STAGED");
    const older = { ...baseSchedule("PARTIAL", "FAILED"), id: "schedule-2" };
    const api = createApi({
      list: vi
        .fn()
        .mockResolvedValueOnce({ ...schedulePage(first), nextCursor: "older" })
        .mockResolvedValueOnce(schedulePage(older)),
    });

    render(<ScheduledUploadsScreen api={api} role="EDITOR" drives={drives} />);
    await screen.findByText("Waiting");
    fireEvent.press(
      screen.getByRole("button", { name: "Load older schedules" }),
    );

    expect(await screen.findByText("Partially complete")).toBeTruthy();
    expect(api.list).toHaveBeenLastCalledWith({ cursor: "older" });
  });

  it("shows a retryable list error separately from the empty state", async () => {
    const api = createApi({
      list: vi.fn(async () => {
        throw new Error("The server is temporarily unavailable.");
      }),
    });

    render(<ScheduledUploadsScreen api={api} role="EDITOR" drives={drives} />);

    expect(
      await screen.findByText("The server is temporarily unavailable."),
    ).toBeTruthy();
    expect(screen.queryByText("No scheduled uploads yet.")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("lets an owner reschedule or cancel before release and retry or abandon partial work", async () => {
    const waitingApi = createApi({
      list: vi.fn(async () => ({
        ...schedulePage(baseSchedule("WAITING", "STAGED")),
      })),
    });
    render(
      <ScheduledUploadsScreen api={waitingApi} role="EDITOR" drives={drives} />,
    );
    expect(await screen.findByText("Waiting")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Reschedule" }));
    fireEvent.press(screen.getByRole("button", { name: "Save new time" }));
    await waitFor(() =>
      expect(waitingApi.updateTime).toHaveBeenCalledWith(
        "schedule-1",
        expect.any(Object),
      ),
    );
    fireEvent.press(screen.getByRole("button", { name: "Cancel schedule" }));
    await waitFor(() =>
      expect(waitingApi.cancel).toHaveBeenCalledWith("schedule-1"),
    );

    const partialApi = createApi({
      list: vi.fn(async () => ({
        ...schedulePage(baseSchedule("PARTIAL", "FAILED")),
      })),
    });
    const partial = render(
      <ScheduledUploadsScreen api={partialApi} role="EDITOR" drives={drives} />,
    );
    expect(await screen.findByText("Partially complete")).toBeTruthy();
    fireEvent.press(
      screen.getByRole("button", { name: "Retry remaining items" }),
    );
    await waitFor(() =>
      expect(partialApi.retry).toHaveBeenCalledWith("schedule-1"),
    );
    partial.unmount();

    const abandonApi = createApi({
      list: vi.fn(async () => ({
        ...schedulePage(baseSchedule("PARTIAL", "FAILED")),
      })),
    });
    render(
      <ScheduledUploadsScreen api={abandonApi} role="EDITOR" drives={drives} />,
    );
    await screen.findByText("Partially complete");
    fireEvent.press(
      screen.getByRole("button", { name: "Abandon remaining items" }),
    );
    await waitFor(() =>
      expect(abandonApi.abandon).toHaveBeenCalledWith("schedule-1"),
    );
  });
});
