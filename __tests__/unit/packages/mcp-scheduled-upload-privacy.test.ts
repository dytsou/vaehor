import { beforeEach, describe, expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({
  tools: new Map<
    string,
    {
      handler: (
        input: unknown,
      ) => Promise<{ content: Array<{ text: string }> }>;
    }
  >(),
}));

vi.mock(
  "../../../packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js",
  () => ({
    McpServer: class {
      registerTool(
        name: string,
        _config: unknown,
        handler: (
          input: unknown,
        ) => Promise<{ content: Array<{ text: string }> }>,
      ) {
        registry.tools.set(name, { handler });
      }

      async connect() {}
    },
  }),
);

vi.mock(
  "../../../packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js",
  () => ({
    StdioServerTransport: class {},
  }),
);

describe("MCP scheduled upload privacy", () => {
  beforeEach(async () => {
    vi.resetModules();
    registry.tools.clear();
    process.env.VAEHOR_SESSION_TOKEN = "mcp-test-token";
    process.env.VAEHOR_BASE_URL = "http://vaehor.test";
    await import("@/packages/mcp/src/index");
  });

  it("keeps staged package content out of MCP file and search tools", async () => {
    expect([...registry.tools.keys()]).toEqual(
      expect.arrayContaining([
        "zee_files_list",
        "zee_search",
        "zee_search_global",
      ]),
    );
    const requests: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        requests.push(url);
        return new Response(
          JSON.stringify({
            files: [{ id: "visible-file", name: "visible-report.txt" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

    const list = await registry.tools.get("zee_files_list")?.handler({});
    const search = await registry.tools
      .get("zee_search")
      ?.handler({ q: "visible" });
    const globalSearch = await registry.tools
      .get("zee_search_global")
      ?.handler({ q: "visible" });
    const output = [list, search, globalSearch]
      .flatMap((result) => result?.content.map((item) => item.text) ?? [])
      .join("\n");

    expect(requests).toEqual([
      "http://vaehor.test/api/files",
      "http://vaehor.test/api/search?q=visible",
      "http://vaehor.test/api/search/global?q=visible",
    ]);
    expect(requests.some((url) => url.includes("/api/scheduled-uploads"))).toBe(
      false,
    );
    expect(registry.tools.has("zee_scheduled_uploads")).toBe(false);
    expect(output).toContain("visible-report.txt");
    expect(output).not.toContain("private-pending-sentinel.txt");

    fetchSpy.mockRestore();
  });
});
