# Mobile artifact release

This document defines the iOS App Store and Google Play release targets for the Expo React Native app in `apps/mobile/`. The app keeps the single publisher identity `com.vaehor.mobile`; operators continue to host their own vaehor servers.

## U1 status

The Expo SDK 57 native project and local development-build commands are the build foundation. The app is **not ready for either store**: only the initial native shell is implemented, the feature rows in [`parity-inventory.md`](./parity-inventory.md) are open, and signed store artifact automation and publisher submission evidence have not been established. Do not submit or publish this foundation build.

The existing `.github/workflows/mobile-release.yml` still contains the old Capacitor release steps. Updating that workflow to create signed Android App Bundles and iOS store archives is unresolved release work; it is not evidence of an Expo store build.

## Native identity and platform targets

The source of app identity and native build settings is [`apps/mobile/app.config.ts`](../../apps/mobile/app.config.ts):

- iOS bundle ID: `com.vaehor.mobile`
- Android application ID: `com.vaehor.mobile`
- URL scheme: `vaehor`
- Android target API: 36 (recheck the Play requirement when submitting)
- iOS deployment target: 16.4
- App version: `1.0.0`; Android `versionCode` starts at 1

Regenerate native projects from this config with `pnpm mobile:prebuild`. Review generated iOS and Android project changes before producing release builds.

## Required artifacts

For the initial public launch, prepare and test both signed release artifacts from the complete parity build:

- Google Play: signed Android App Bundle (`.aab`), uploaded to an internal testing track before production rollout
- Apple App Store: signed iOS archive exported for App Store Connect, uploaded to TestFlight before public release

The local `pnpm mobile:android` and `pnpm mobile:ios` commands create development builds for a simulator or connected device. They are not store artifacts. The `pnpm mobile:build` command exports JavaScript bundles for both native platforms; it does not sign or package store binaries.

## Release gates

- [ ] Both platforms implement every release-critical row in [`parity-inventory.md`](./parity-inventory.md), with evidence for user, share, setup, admin, and access-control flows.
- [ ] Verify the final iOS and Android store builds against the same feature set; no product task may fall back to a WebView or hosted website.
- [ ] Implement and run CI that creates a signed Android App Bundle and signed iOS archive from the Expo native project. The current Capacitor workflow is obsolete and must be replaced before release automation is used.
- [ ] Configure publisher signing credentials and verify artifact provenance without checking secrets into the repository.
- [ ] Set unique release build numbers and confirm both artifacts use `com.vaehor.mobile` and `vaehor`.
- [ ] Recheck current App Store and Google Play policies, Android target API requirements, permissions, and privacy declarations at submission time.
- [ ] Provide both store reviewers with a reachable HTTPS self-hosted review server, user and administrator accounts, and working authentication instructions.
- [ ] Complete store listings, support contact, privacy policy, data-safety declarations, screenshots, and required app-content questionnaires.
- [ ] Test each platform's internal distribution track before public release.

## Authentication and operator setup

Google OAuth may open the system browser and return through `vaehor://auth/callback`. A product screen must remain native. Callback handling and real-device sign-in verification are tracked as unresolved in the parity inventory; the callback scheme alone does not prove the flow works.

Operators must make their server reachable over HTTPS and configure the existing server-side mobile OAuth routes as the authentication unit is completed. Store review requires a server and reviewer credentials that remain available throughout review.

## Branding and versioning

The icon source is [`apps/mobile/resources/icon.svg`](../../apps/mobile/resources/icon.svg), rasterized for Expo from `apps/mobile/resources/icon.png`. Review generated launcher icons and launch screens on both platforms before release. Set the app's marketing version in `app.config.ts`, Android `versionCode`, and iOS build number according to the selected build automation.

For local development steps, see [`development.md`](./development.md).
