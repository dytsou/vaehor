# Operator Universal Links and App Links

## Current status

The React Native source handles the `vaehor://auth/callback` OAuth callback and custom `vaehor://share` links, then routes share recipients to a native screen. Real-device routing is still unverified. HTTPS App Links are not configured for arbitrary self-hosted operator domains, so an HTTPS link may continue to open in the browser until the publisher adds and verifies domain associations.

Share authorization remains enforced by the self-hosted server and `lib/share-scope.ts`. Track device evidence and link-routing gaps in [`parity-inventory.md`](./parity-inventory.md).

## Baseline link formats

The previous mobile client recognized these link forms:

```text
vaehor://share?origin=https://files.example.com&path=/en/share/SHARE_ID&share_token=TOKEN
https://files.example.com/en/share/SHARE_ID?share_token=TOKEN
```

The custom scheme identifies the operator origin and locale-prefixed destination. The HTTPS form requires an app association on the same domain.

## Association requirements for HTTPS App Links

For HTTPS links to open in the native app, a publisher build must include the operator domain in iOS Associated Domains and Android verified intent filters, and the operator must serve the appropriate association files without redirects:

- `public/.well-known/apple-app-site-association.example`
- `public/.well-known/assetlinks.json.example`

The current native config does not register per-operator domains. Each associated domain requires a publisher build. Verify association behavior on real iOS and Android devices before considering these operator steps usable.
