# Operator Universal Links and App Links

## Current status

The React Native foundation does not yet receive or route OAuth callbacks, custom share links, or HTTPS App Links. Deep-link handling is tracked in [`parity-inventory.md`](./parity-inventory.md) and will be implemented and tested in U2. The old Capacitor path loaded share tasks in a WebView and was removed as part of the migration; there is no website fallback in the current app.

Do not treat the examples below as an active integration until U2 closes the iOS and Android link-routing rows. Share authorization remains enforced by the self-hosted server and `lib/share-scope.ts`.

## Baseline link formats

The previous mobile client recognized these link forms:

```text
vaehor://share?origin=https://files.example.com&path=/en/share/SHARE_ID&share_token=TOKEN
https://files.example.com/en/share/SHARE_ID?share_token=TOKEN
```

The custom scheme identifies the operator origin and locale-prefixed destination. The HTTPS form requires an app association on the same domain.

## Association requirements for U2 device verification

For HTTPS links to open in the native app, a publisher build must include the operator domain in iOS Associated Domains and Android verified intent filters, and the operator must serve the appropriate association files without redirects:

- `public/.well-known/apple-app-site-association.example`
- `public/.well-known/assetlinks.json.example`

The current native config does not register per-operator domains. Each associated domain requires a publisher build. U2 must verify association behavior on real iOS and Android devices before these operator steps are considered usable.
