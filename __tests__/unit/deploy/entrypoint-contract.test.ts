import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");

describe("deploy/docker entrypoint contract", () => {
  const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");

  it("installs postgresql-client and dumb-init in the runner stage", () => {
    expect(dockerfile).toContain("postgresql-client");
    expect(dockerfile).toContain("dumb-init");
  });

  it("installs global prisma matching the lockfile major version", () => {
    expect(dockerfile).toContain(
      "npm install -g prisma@7.7.0 --ignore-scripts",
    );
  });

  it("copies entrypoint.sh with execute permission", () => {
    expect(dockerfile).toContain(
      "COPY --chown=root:root --chmod=755 scripts/entrypoint.sh /app/entrypoint.sh",
    );
  });

  it("wires dumb-init through entrypoint.sh to node server.js", () => {
    expect(dockerfile).toContain(
      'ENTRYPOINT ["dumb-init", "--", "/app/entrypoint.sh"]',
    );
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
  });
});
