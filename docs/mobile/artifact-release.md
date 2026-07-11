# Artifact release (direct distribution)

See [development.md](./development.md) for local device testing before building release binaries.

Checklist for distributing **vaehor Mobile** (`com.vaehor.mobile`) as installable artifacts — signed APK (Android) and locally exported IPA (iOS). This is a single publisher app; operators self-host the backend and add their server URL in the app.

This project does **not** publish through App Store or Google Play.

## CI workflow

GitHub Actions: [`.github/workflows/mobile-release.yml`](../../.github/workflows/mobile-release.yml)

Triggers:

- Push tag `mobile-v*` (e.g. `mobile-v1.0.0`)
- Manual **workflow_dispatch**

Artifacts:

| Job               | Output                                     |
| ----------------- | ------------------------------------------ |
| `build-shell`     | Validates shell build + tests              |
| `android-release` | Signed release `.apk` (sideload)           |
| `ios-archive`     | `.xcarchive` (when iOS secrets configured) |

The iOS job is skipped entirely when `IOS_CERTIFICATE_BASE64` is not set.

### Repository secrets

**Android**

| Secret                      | Description                          |
| --------------------------- | ------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`   | Base64-encoded `.keystore` or `.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password                    |
| `ANDROID_KEY_ALIAS`         | Key alias                            |
| `ANDROID_KEY_PASSWORD`      | Key password                         |

Without Android secrets, CI still builds an **unsigned** release APK.

**iOS** (macOS runner)

| Secret                            | Description                       |
| --------------------------------- | --------------------------------- |
| `IOS_CERTIFICATE_BASE64`          | Distribution `.p12` (base64)      |
| `IOS_CERTIFICATE_PASSWORD`        | Certificate password              |
| `IOS_PROVISIONING_PROFILE_BASE64` | Distribution provisioning profile |
| `IOS_KEYCHAIN_PASSWORD`           | Ephemeral keychain password       |

CI archives a signed `.xcarchive`. Export to `.ipa` locally (see below).

## Pre-release checklist

### App identity

- [ ] Bundle ID / application ID: `com.vaehor.mobile` (matches `apps/mobile/capacitor.config.ts`)
- [ ] Bump `versionCode` / `versionName` in `apps/mobile/android/app/build.gradle` and iOS `MARKETING_VERSION` before each release tag

### Branding

- [ ] Replace placeholder icons/splash under `apps/mobile/android/app/src/main/res/` and iOS asset catalog
- [ ] Final display name in `capacitor.config.ts` (`appName`)

### OAuth (mobile Google sign-in)

- [ ] Register authorized redirect URI: `vaehor://auth/callback` on the Google OAuth client used for mobile
- [ ] `NEXTAUTH_URL` on each operator server matches their public HTTPS domain

### Privacy

- [ ] Privacy policy URL (publisher-hosted) for users who sideload the app
- [ ] Document what data the app stores (session cookies, server URL, no analytics in shell v1 unless added)

### Backend

- [ ] Operator deployment on Traefik with valid TLS ([`docs/deployment.md`](../deployment.md))
- [ ] Staging validation: large upload (>50 MB) and share deep link

## Download and install

### Android (APK)

1. Open the workflow run for tag `mobile-v*`.
2. Download artifact **`vaehor-android-apk`**.
3. Transfer the APK to the device and install (enable "Install unknown apps" for your file manager or browser if prompted).

### iOS (archive → IPA on macOS)

1. Download artifact **`vaehor-ios-archive`** from the workflow run.
2. Copy the `.xcarchive` to a Mac with Xcode installed.
3. Export IPA using one of:
   - **Xcode:** Window → Organizer → import archive → Distribute App → choose Ad Hoc, Development, or Enterprise (must match your provisioning profile).
   - **CLI:** copy [`apps/mobile/ios/ExportOptions.plist.example`](../../apps/mobile/ios/ExportOptions.plist.example) to `ExportOptions.plist`, set `method` and `provisioningProfiles`, then:

     ```bash
     xcodebuild -exportArchive \
       -archivePath /path/to/Vaehor.xcarchive \
       -exportPath ./export \
       -exportOptionsPlist ExportOptions.plist
     ```

4. Install the IPA via Apple Configurator, MDM, or another method allowed by your export method (Ad Hoc requires device UDIDs in the profile).

## Versioning

- Tag format: `mobile-vX.Y.Z`
- Bump Android `versionCode` / `versionName` and iOS `MARKETING_VERSION` before tagging.

## Local release build (optional)

```bash
pnpm --filter @vaehor/mobile run build
cd apps/mobile && pnpm exec cap sync
cd android && ./gradlew :app:assembleRelease   # set ANDROID_KEYSTORE_* env vars
```

Output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

iOS requires macOS, CocoaPods, and Xcode signing — prefer CI for reproducible archives, then export IPA locally.
