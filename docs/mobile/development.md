# Mobile development

`apps/mobile/` is an Expo SDK 57 and React Native 0.86 development-build app. Its UI, navigation, and task screens run natively on iOS and Android. Product tasks do not load the self-hosted website in a WebView. The selected server remains the authority for user accounts, permissions, file data, and administrative changes.

The initial route is a native server-selection shell with system theme and device-language selection, plus loading, network-loss, retry, and recoverable-error states. The first screen is foundation work; server management and product task screens are being migrated in the units listed in [`parity-inventory.md`](./parity-inventory.md).

## Prerequisites

- Node 26 and pnpm 11, matching the monorepo root engines
- Android Studio and Android SDK for Android development
- Xcode and CocoaPods for iOS development (macOS only)
- A reachable self-hosted vaehor instance for end-to-end feature work

Install the workspace from the repository root:

```bash
pnpm install --frozen-lockfile
```

## Run the development build

Start the Expo development server:

```bash
pnpm mobile:dev
```

Build and install the native development client on a connected device or simulator:

```bash
pnpm mobile:android
pnpm mobile:ios       # macOS with Xcode
```

Metro hot reload serves the React Native bundle to the installed development client. The configured self-hosted server is a separate backend origin; the client does not display that server's website as an app screen.

The platform directories are generated from [`apps/mobile/app.config.ts`](../../apps/mobile/app.config.ts). Regenerate them after changing Expo native configuration:

```bash
pnpm mobile:prebuild
```

For a clean regeneration, which recreates the native project directories, run:

```bash
pnpm --filter @vaehor/mobile run prebuild:clean
```

## Test and typecheck

The mobile test command runs the existing Vitest utility suite and the focused Jest/React Native shell suite:

```bash
pnpm mobile:test
pnpm --filter @vaehor/mobile exec jest --preset jest-expo --runInBand __tests__/app-shell.test.tsx
pnpm exec tsc -p apps/mobile/tsconfig.json --noEmit
```

The shell test covers the initial server-selection screen, loading, offline retry, recoverable error, locale, and theme; it verifies no browser placeholder is rendered. The U1 route currently contains only that native shell. Physical-device authentication, deep links, and product parity remain open in the inventory.

## Local backend

For backend work on a local network, bind Next.js to the LAN and use a reachable HTTPS development origin when testing device authentication:

```bash
pnpm dev --hostname 0.0.0.0
```

Production servers must use HTTPS. Do not use a development server URL as a product-screen fallback; configure the native app to call the selected server's API after that feature's parity unit is implemented.

## App identity

- Display name: `vaehor`
- Bundle/application ID: `com.vaehor.mobile` on iOS and Android
- URL scheme: `vaehor`
- Version: `1.0.0` foundation version; increment the platform build numbers for release artifacts

## Related docs

- [Parity inventory](./parity-inventory.md)
- [Artifact release](./artifact-release.md)
- [Operator Universal Links](./operator-universal-links.md)
- [Deployment](../deployment.md)
