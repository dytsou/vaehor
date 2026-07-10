# Mobile development

Native shell lives in `apps/mobile/`. It wraps the self-hosted vaehor web UI in a WebView and adds OAuth, biometrics, file upload, and deep links.

## Prerequisites

- Node 24 + pnpm 11 (same as the monorepo root)
- Android Studio (Android) or Xcode + CocoaPods (iOS)
- A reachable vaehor instance for OAuth and WebView testing (local `pnpm dev`, Docker dev stack, or staging HTTPS)

## Shell-only development

Run the Vite dev server for native screens (bookmarks, settings, upload overlay):

```bash
pnpm mobile:dev
```

Build and sync into native projects:

```bash
pnpm mobile:build
pnpm mobile:sync
```

Open the native IDE:

```bash
cd apps/mobile && pnpm exec cap open android
# iOS (macOS): brew install cocoapods && pnpm exec cap add ios && pnpm exec cap open ios
```

## Live reload on a physical device (R18)

Point the WebView at your dev machine on the LAN instead of bundled `dist/` assets.

1. Start the shell dev server (default Vite port **5173**):

   ```bash
   pnpm mobile:dev
   ```

2. Find your machine's LAN address (example: `192.168.1.42`).

3. Export the URL and sync:

   ```bash
   export CAPACITOR_SERVER_URL="http://192.168.1.42:5173"
   cd apps/mobile && CAPACITOR_SERVER_URL="$CAPACITOR_SERVER_URL" pnpm exec cap sync
   ```

4. Run on device from Android Studio or Xcode. The app loads the dev server; edits to `apps/mobile/src` hot-reload.

5. **WebView content** still targets the operator server URL you configure in the app (your `pnpm dev` or staging host). Test against `http://YOUR_LAN_IP:3000` only if that origin is in the backend mobile CORS allowlist.

Unset `CAPACITOR_SERVER_URL` (or omit it) before store builds so release bundles ship static assets from `dist/`.

## Backend on the same network

For end-to-end OAuth and upload tests against a local Next.js app:

```bash
pnpm dev --hostname 0.0.0.0
```

Use `http://YOUR_LAN_IP:3000` as the server bookmark. Production builds require HTTPS.

## Tests

```bash
pnpm exec vitest run apps/mobile/__tests__
```

## Related docs

- [Store release](./store-release.md)
- [Operator Universal Links](./operator-universal-links.md)
- [Deployment](../deployment.md) — Traefik TLS for staging/production
