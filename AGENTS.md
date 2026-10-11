<!-- BEGIN:vinext-agent-rules -->

# This is NOT the Next.js you know

This app runs on **vinext** (Vite-based App Router). APIs look like Next.js (`next/server`, `next/navigation`, …) but resolve through vinext shims and `@vinext/types`. Read vinext docs under `node_modules/vinext/` before assuming Next CLI behavior.

- Typecheck: commit `next-env.d.ts` (references `vinext/types`); do not regenerate it with `next` typegen.
- Dev/build/start: `pnpm dev` / `pnpm build` / `pnpm start` (Vite + vinext), not `next dev` / `next build`.

<!-- END:vinext-agent-rules -->
