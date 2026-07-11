# Operator Universal Links and App Links

vaehor Mobile opens share URLs in the native app via two mechanisms:

1. **Custom scheme (default, no server setup)** — `vaehor://share?origin=…&path=…&share_token=…`
2. **HTTPS Universal Links / App Links (optional)** — `https://your-domain/en/share/…?share_token=…`

Share authorization (login required, prevent-download, token expiry) is enforced by the existing web app and `lib/share-scope.ts`. The mobile shell only navigates the WebView; it does not bypass share rules.

## Custom scheme links

Generate links in this form:

```text
vaehor://share?origin=https://files.example.com&path=/en/share/SHARE_ID&share_token=TOKEN
```

- `origin` — operator public URL (scheme + host, no path)
- `path` — locale-prefixed web path (`/en/share/…`, `/id/folder/…`, etc.)
- `share_token` — optional; append when the share uses token auth

Works on iOS and Android without hosting extra files on the operator domain.

## Universal Links (iOS) and App Links (Android)

HTTPS links open in-app **only** when:

1. The operator hosts the well-known files below on the **same domain** users visit in the browser.
2. The A4 publisher build includes that domain in **Associated Domains** (iOS) or intent filters with `autoVerify` (Android).

v1 does **not** discover operator domains at runtime. Each domain requires an app update or a custom build from the publisher (A4).

### Steps for operators

1. Copy the example files from this repo:
   - `public/.well-known/apple-app-site-association.example` → `https://YOUR_DOMAIN/.well-known/apple-app-site-association`
   - `public/.well-known/assetlinks.json.example` → `https://YOUR_DOMAIN/.well-known/assetlinks.json`
2. Replace `TEAMID` (iOS) and `SHA256_CERT_FINGERPRINT` (Android) with values from the A4 release build.
3. Serve without redirects (200 OK, `Content-Type: application/json` for AASA).
4. Request the publisher add `applinks:YOUR_DOMAIN` to the iOS entitlements for your deployment.

### Supported paths

Any locale-prefixed share or folder route with optional `share_token`:

- `/en/share/*`, `/id/share/*`, `/zh-TW/share/*`
- `/en/folder/*` (and other locales)
- Any path with `?share_token=`

## Unknown server

If a deep link targets a host that is not in the user's server list, the app prompts to add that server first, then opens the share route.

## Testing

- **AE6:** Install the app → open a `vaehor://share?…` link → share page loads in WebView.
- **HTTPS:** After AASA/assetlinks + entitlements → tap `https://operator/share/…` → app opens (device matrix in release QA).
