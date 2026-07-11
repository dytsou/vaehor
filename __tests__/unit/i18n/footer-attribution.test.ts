import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../..");

describe("footer attribution i18n", () => {
  it("exposes modificationsBy in every locale", () => {
    for (const locale of ["en", "id", "zh-TW"]) {
      const messages = JSON.parse(
        readFileSync(join(root, `messages/${locale}.json`), "utf8"),
      ) as { Footer: { rightsReserved: string; modificationsBy: string } };
      expect(messages.Footer.rightsReserved.length).toBeGreaterThan(0);
      expect(messages.Footer.modificationsBy.length).toBeGreaterThan(0);
    }
  });

  it("login and setup footers use Footer i18n keys, not hardcoded English", () => {
    for (const rel of [
      "app/[locale]/login/page.tsx",
      "app/[locale]/setup/page.tsx",
    ]) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src).toContain('tFooter("rightsReserved")');
      expect(src).toContain('tFooter("modificationsBy")');
      expect(src).not.toContain("All rights reserved -");
      expect(src).not.toContain("Modifications by");
    }
  });
});
