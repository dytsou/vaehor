import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_ROOT, isPathInsideLocalRoot } from "@/lib/storage/local";

describe("lib/storage/local", () => {
  it("accepts files that stay inside the local storage root", () => {
    const safePath = path.join(LOCAL_ROOT, "folder", "file.txt");

    expect(isPathInsideLocalRoot(safePath)).toBe(true);
  });

  it("rejects sibling paths that only share the same prefix", () => {
    const escapedPath = path.join(`${LOCAL_ROOT}-escape`, "secret.txt");

    expect(isPathInsideLocalRoot(escapedPath)).toBe(false);
  });

  it("rejects parent-directory traversal outside the root", () => {
    const escapedPath = path.resolve(LOCAL_ROOT, "..", "secret.txt");

    expect(isPathInsideLocalRoot(escapedPath)).toBe(false);
  });
});
