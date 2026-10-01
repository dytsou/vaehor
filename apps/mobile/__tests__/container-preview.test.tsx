import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ContainerPreview } from "../src/components/container-preview";
import {
  loadDocumentPreview,
  type DocumentPreview,
} from "../src/lib/document-preview";

jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => ({
    size: 1,
    arrayBuffer: async () => new ArrayBuffer(1),
  })),
}));

jest.mock("../src/lib/document-preview", () => ({
  DocumentPreviewError: class DocumentPreviewError extends Error {},
  loadDocumentPreview: jest.fn(),
  MAX_CONTAINER_PREVIEW_BYTES: 20 * 1024 * 1024,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function archivePreview(
  path: string,
  readTextEntry: (entryPath: string) => Promise<string>,
): Extract<DocumentPreview, { type: "archive" }> {
  return {
    type: "archive",
    entries: [{ path, size: 4, isFolder: false, canPreviewText: true }],
    readTextEntry,
  };
}

describe("ContainerPreview archive selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ignores a pending entry read after the source archive changes", async () => {
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    const firstReadTextEntry = jest.fn(() => firstRead.promise);
    const firstPreview = archivePreview("first.txt", firstReadTextEntry);
    const secondPreview = archivePreview(
      "second.txt",
      () => secondRead.promise,
    );
    jest
      .mocked(loadDocumentPreview)
      .mockResolvedValueOnce(firstPreview)
      .mockResolvedValueOnce(secondPreview);

    const view = await render(
      <ContainerPreview kind="archive" title="first.zip" uri="file:first" />,
    );
    await waitFor(() => expect(view.getByText("first.txt")).toBeTruthy());
    fireEvent.press(view.getByRole("button"));
    await waitFor(() =>
      expect(firstReadTextEntry).toHaveBeenCalledWith("first.txt"),
    );

    await view.rerender(
      <ContainerPreview kind="archive" title="second.zip" uri="file:second" />,
    );
    await waitFor(() => expect(view.getByText("second.txt")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByRole("button"));
      secondRead.resolve("new content");
      await secondRead.promise;
    });
    await waitFor(() => expect(view.getByText("new content")).toBeTruthy());

    await act(async () => {
      firstRead.resolve("stale content");
      await firstRead.promise;
    });

    expect(view.getByText("new content")).toBeTruthy();
    expect(view.queryByText("stale content")).toBeNull();
  });
});
