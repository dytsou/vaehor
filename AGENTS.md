<!-- BEGIN:vinext-agent-rules -->

# This is NOT the Next.js you know

This app runs on **vinext** (Vite-based App Router). APIs look like Next.js (`next/server`, `next/navigation`, …) but resolve through vinext shims and `@vinext/types`. Read vinext docs under `node_modules/vinext/` before assuming Next CLI behavior.

- Typecheck: commit `next-env.d.ts` (references `vinext/types`); do not regenerate it with `next` typegen.
- Dev/build/start: `pnpm dev` / `pnpm build` / `pnpm start` (Vite + vinext), not `next dev` / `next build`.

<!-- END:vinext-agent-rules -->

## Cloud Agent environment

- Node.js 26.12.0 and pnpm 11.17.0 live in `/usr/local/node`. Login shells prepend that directory. Do not use the Node 22 binary on the default image.
- PostgreSQL 16 and Redis 7 are system services on `127.0.0.1:5432` and `127.0.0.1:6379` (`postgres` / `postgres` / database `vaehor`). They start on boot. `pnpm deps:up` expects Docker and is not used in this environment.
- The dev server is already running at http://127.0.0.1:3000. A gitignored `.env` is created on first boot. Local admin email is `admin@example.com`; the password is `ADMIN_PASSWORD` in that file.
- `GOOGLE_*` values in the generated `.env` are placeholders so the app can leave the setup gate. Replace them with real Google Drive credentials before browsing Drive. Until then, `/api/health` reports `google_drive` as unhealthy and the file manager asks for setup.
