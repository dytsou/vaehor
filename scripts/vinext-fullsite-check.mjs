#!/usr/bin/env node
/**
 * Full-site inventory against a running vinext server (U6).
 * Usage: BASE_URL=http://localhost:3001 node scripts/vinext-fullsite-check.mjs
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE_URL || "http://localhost:3001").replace(
  /\/$/,
  "",
);
const TIMEOUT_MS = Number(process.env.FULLSITE_TIMEOUT_MS || 30_000);

const MIN_PAGES = 14;
const MIN_API = 80;

async function walk(dir, predicate) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full, predicate)));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function pageFileToUrl(file) {
  let rel = path.relative(path.join(ROOT, "app"), file).replace(/\\/g, "/");
  rel = rel.replace(/\/page\.tsx$/, "");
  rel = rel.replace(/\(main\)\//g, "");
  rel = rel.replace(/\[locale\]/g, "en");
  rel = rel.replace(/\[([^\]]+)\]/g, "x");
  return rel === "" ? "/" : `/${rel}`;
}

function apiFileToUrl(file) {
  let rel = path.relative(path.join(ROOT, "app"), file).replace(/\\/g, "/");
  rel = rel.replace(/\/route\.ts$/, "");
  rel = rel.replace(/\[\.\.\.[^\]]+\]/g, "x");
  rel = rel.replace(/\[([^\]]+)\]/g, "x");
  return `/${rel}`;
}

async function fetchResult(url, { method = "GET", cookie } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      signal: ctrl.signal,
      headers: cookie ? { cookie } : undefined,
    });
    const body = await res.text().catch(() => "");
    return { status: res.status, body };
  } catch (err) {
    return {
      status:
        err?.name === "AbortError" ? "TIMEOUT" : `ERR:${err?.message || err}`,
      body: "",
    };
  } finally {
    clearTimeout(t);
  }
}

/** Local .env SA key often fails OpenSSL decode — not a vinext/app regression. */
function isGoogleKeyEnvFailure(status, body) {
  return (
    status === 500 &&
    /DECODER routines::unsupported|ERR_OSSL_UNSUPPORTED/.test(body)
  );
}

function okPage(status, body) {
  if (isGoogleKeyEnvFailure(status, body)) return true;
  return typeof status === "number" && status < 500;
}

function okApiUnauthed(status, body) {
  if (isGoogleKeyEnvFailure(status, body)) return true;
  return typeof status === "number" && status < 500;
}
async function guestCookie() {
  const res = await fetch(`${BASE}/api/auth/vaehor/sign-in/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`guest sign-in failed: ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

const pageFiles = await walk(path.join(ROOT, "app"), (f) =>
  f.endsWith("/page.tsx"),
);
const apiFiles = await walk(path.join(ROOT, "app/api"), (f) =>
  f.endsWith("/route.ts"),
);

const pages = [...new Set(pageFiles.map(pageFileToUrl))].sort();
const apis = [...new Set(apiFiles.map(apiFileToUrl))].sort();

const failures = [];
const notes = [];

if (pages.length < MIN_PAGES) {
  failures.push(`page inventory ${pages.length} < ${MIN_PAGES}`);
}
if (apis.length < MIN_API) {
  failures.push(`api inventory ${apis.length} < ${MIN_API}`);
}

console.log(`BASE ${BASE}`);
console.log(`pages ${pages.length} api ${apis.length}`);

for (const p of pages) {
  const { status, body } = await fetchResult(`${BASE}${p}`);
  const line = `PAGE ${status} ${p}`;
  if (!okPage(status, body)) {
    failures.push(line);
    console.log(`FAIL ${line}`);
  } else if (isGoogleKeyEnvFailure(status, body)) {
    console.log(`skip ${line} (google key env)`);
  } else {
    console.log(`ok   ${line}`);
  }
}

for (const a of apis) {
  const { status, body } = await fetchResult(`${BASE}${a}`);
  const line = `API  ${status} ${a}`;
  if (!okApiUnauthed(status, body)) {
    failures.push(line);
    console.log(`FAIL ${line}`);
  } else if (isGoogleKeyEnvFailure(status, body)) {
    console.log(`skip ${line} (google key env)`);
  } else {
    console.log(`ok   ${line}`);
  }
}
let cookie = "";
try {
  cookie = await guestCookie();
  notes.push("guest session acquired");
} catch (err) {
  failures.push(`guest session: ${err.message}`);
}

if (cookie) {
  for (const sample of ["/api/auth/me", "/en/favorites"]) {
    const { status, body } = await fetchResult(`${BASE}${sample}`, { cookie });
    const line = `AUTH ${status} ${sample}`;
    if (!okPage(status, body)) {
      failures.push(line);
      console.log(`FAIL ${line}`);
    } else {
      console.log(`ok   ${line}`);
    }
  }
}

console.log("---");
console.log(`failures ${failures.length}`);
for (const f of failures) console.log(`  ${f}`);
if (notes.length) console.log(`notes: ${notes.join("; ")}`);

process.exit(failures.length ? 1 : 0);
