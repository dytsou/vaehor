# Mobile artifact release

This document defines the iOS App Store and Google Play release targets for the Expo React Native app in `apps/mobile/`. The app keeps the publisher identity `com.vaehor.mobile`; operators continue to host their own Vaehor servers.

## Current status

The product routes are implemented as React Native screens and native API calls. The parity inventory still has in-app preview, admin parity, localization and device-acceptance gaps. No signed store artifact or internal-track acceptance evidence exists, so the app is **not ready for either store**.

The mobile workflow validates source code and exports iOS and Android JavaScript bundles. It does not sign a binary, upload it to either store, or submit the app. This migration task does not submit either store app.

## Native identity and platform targets

The source of app identity and native build settings is [`apps/mobile/app.config.ts`](../../apps/mobile/app.config.ts):

- iOS bundle ID: `com.vaehor.mobile`
- Android application ID: `com.vaehor.mobile`
- URL scheme: `vaehor`
- Android target API: 36 (recheck the Play requirement when submitting)
- iOS deployment target: 16.4
- App version: `1.0.0`; Android `versionCode` starts at 1

Regenerate native projects from this config with `pnpm mobile:prebuild`. Review the generated iOS and Android project changes before producing release builds.

## Required artifacts

For the initial public launch, prepare and test both signed release artifacts from the complete parity build:

- Google Play: signed Android App Bundle (`.aab`), uploaded to an internal testing track before production rollout
- Apple App Store: signed iOS archive exported for App Store Connect, uploaded to TestFlight before public release

The local `pnpm mobile:android` and `pnpm mobile:ios` commands create development builds for a simulator or connected device. `pnpm mobile:build` exports JavaScript bundles for both native platforms; it does not sign or package store binaries.

## Release gates

- [ ] Close every release-critical gap in [`parity-inventory.md`](./parity-inventory.md), including native document preview, admin reconciliation and language coverage.
- [ ] Complete representative user, share, setup, admin and access-control flows on physical iOS and Android devices.
- [ ] Verify that the submitted product flows stay in React Native screens. System-browser OAuth and opening a downloaded file in an installed viewer are the documented native system handoffs.
- [ ] Create signed Android App Bundle and iOS App Store archive builds from the Expo native project; keep signing credentials out of the repository.
- [ ] Verify both artifacts use `com.vaehor.mobile` and `vaehor`, with unique build numbers and correct platform permissions.
- [ ] Recheck current App Store and Google Play policies, Android target API requirements, permissions and privacy declarations at submission time.
- [ ] Provide both store reviewers with a reachable HTTPS self-hosted review server, user and administrator accounts, and working authentication instructions.
- [ ] Complete store listings, support contact, privacy policy, data-safety declarations, screenshots and required app-content questionnaires.
- [ ] Test each platform's internal distribution track before public release.

## Authentication and operator setup

Google OAuth opens the system browser and returns through `vaehor://auth/callback`. The code path exists, but real-device callback and sign-in acceptance remains open in the parity inventory. The callback scheme by itself does not prove the flow works.

Operators must make their server reachable over HTTPS and configure the existing server-side mobile OAuth routes. Store review also requires a server and reviewer credentials that remain available throughout review.

## Branding and versioning

The icon source is [`apps/mobile/resources/icon.svg`](../../apps/mobile/resources/icon.svg), rasterized for Expo from `apps/mobile/resources/icon.png`. Review generated launcher icons and launch screens on both platforms before release. Set the app's marketing version in `app.config.ts`, Android `versionCode` and iOS build number according to the selected build automation.

For local development steps, see [`development.md`](./development.md).
