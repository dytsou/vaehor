# Mobile development

`apps/mobile/` is an Expo SDK 57 and React Native 0.86 development-build app. Its UI, navigation, and task screens run natively on iOS and Android. Product tasks do not load the self-hosted website in a WebView. The selected server remains the authority for user accounts, permissions, file data, and administrative changes.

The native routes include server selection and authentication, file browsing and management, native previews, shares and file requests, settings, setup, and an initial admin area. Current source coverage and remaining device or feature gaps are tracked in [`parity-inventory.md`](./parity-inventory.md).

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

The mobile test command runs the Vitest utility suite and the focused Jest/React Native shell suite:

```bash
pnpm mobile:test
pnpm typecheck
pnpm mobile:build
```

The shell test covers server selection, loading, offline retry, recoverable errors, locale, and theme. The Vitest suite covers mobile API and utility behavior. These checks do not replace iOS and Android simulator or physical-device acceptance; consult the inventory for those open flows.

## Local backend

For backend work on a local network, bind Next.js to the LAN and use a reachable HTTPS development origin when testing device authentication:

```bash
pnpm dev --hostname 0.0.0.0
```

Production servers must use HTTPS. Native product screens call the selected server's API; they do not display the hosted product website.

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
