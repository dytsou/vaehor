# Store release (A4 publisher)

See [development.md](./development.md) for local device testing before submission.

Checklist for shipping **vaehor Mobile** (`com.vaehor.mobile`) to App Store and Google Play. This is a single publisher app; operators self-host the backend and add their server URL in the app.

## CI workflow

GitHub Actions: [`.github/workflows/mobile-release.yml`](../../.github/workflows/mobile-release.yml)

Triggers:

- Push tag `mobile-v*` (e.g. `mobile-v1.0.0`)
- Manual **workflow_dispatch**

Artifacts:

| Job               | Output                                     |
| ----------------- | ------------------------------------------ |
| `build-shell`     | Validates shell build + tests              |
| `android-release` | `.aab` (Play Console upload)               |
| `ios-archive`     | `.xcarchive` (when iOS secrets configured) |

### Repository secrets

**Android**

| Secret                      | Description                          |
| --------------------------- | ------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`   | Base64-encoded `.keystore` or `.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password                    |
| `ANDROID_KEY_ALIAS`         | Key alias                            |
| `ANDROID_KEY_PASSWORD`      | Key password                         |

**iOS** (macOS runner)

| Secret                            | Description                  |
| --------------------------------- | ---------------------------- |
| `IOS_CERTIFICATE_BASE64`          | Distribution `.p12` (base64) |
| `IOS_CERTIFICATE_PASSWORD`        | Certificate password         |
| `IOS_PROVISIONING_PROFILE_BASE64` | App Store profile (base64)   |
| `IOS_KEYCHAIN_PASSWORD`           | Ephemeral keychain password  |

Without iOS secrets, the iOS job still adds the platform and runs `pod install` but skips signing/archive.

## Pre-submission checklist

### Accounts and IDs

- [ ] Apple Developer Program (A4 team account)
- [ ] Google Play Console developer account (A4)
- [ ] Bundle ID / application ID: `com.vaehor.mobile` (matches `apps/mobile/capacitor.config.ts`)
- [ ] App Store Connect app record created
- [ ] Play Console app created

### Branding (KTD8)

- [ ] Replace placeholder icons/splash under `apps/mobile/android/app/src/main/res/` and iOS asset catalog after `cap add ios`
- [ ] Final display name in `capacitor.config.ts` (`appName`)
- [ ] Store screenshots and descriptions

### OAuth (mobile Google sign-in)

- [ ] Register authorized redirect URI: `vaehor://auth/callback` on the Google OAuth client used for mobile (or document operator-specific clients)
- [ ] `NEXTAUTH_URL` on each operator server matches their public HTTPS domain

### Privacy and compliance

- [ ] App Privacy / Data Safety questionnaire (session cookies, server URL user input, no analytics in shell v1 unless added)
- [ ] Privacy policy URL (publisher-hosted)
- [ ] Export compliance (standard HTTPS-only app: typically exempt)

### Backend

- [ ] Operator deployment on Traefik with valid TLS ([`docs/deployment.md`](../deployment.md))
- [ ] Staging validation: AE5 (>50 MB upload), AE6 (share deep link)

## Upload steps

### Google Play

1. Download `vaehor-android-aab` artifact from the workflow run.
2. Play Console → **Release** → **Production** (or internal testing) → upload AAB.
3. Complete content rating and target audience if not done.

### App Store

1. Download `vaehor-ios-archive` artifact.
2. Open Xcode → **Window → Organizer** → import archive, or use `xcodebuild -exportArchive` with an ExportOptions.plist.
3. Upload to App Store Connect via Xcode or Transporter.
4. Submit for review with test account notes (self-hosted server URL required).

## Versioning

- Tag format: `mobile-vX.Y.Z`
- Bump `versionCode` / `versionName` in `apps/mobile/android/app/build.gradle` and iOS `MARKETING_VERSION` before each store release.

## Local release build (optional)

```bash
pnpm --filter @vaehor/mobile run build
cd apps/mobile && pnpm exec cap sync
cd android && ./gradlew :app:bundleRelease   # set ANDROID_KEYSTORE_* env vars
```

iOS requires macOS, CocoaPods, and Xcode signing — prefer CI for reproducible archives.
