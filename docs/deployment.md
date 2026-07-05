# Deployment

Production Zee-Index runs via Docker Compose with **Traefik v3** as the reverse proxy on ports 80 and 443. Traefik terminates TLS and routes traffic to the `zee-index` Next.js container.

## Required environment variables

| Variable     | Description                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `DOMAIN`     | Public hostname users and the mobile app connect to (e.g. `files.example.com` or `zee-index.duckdns.org`) |
| `ACME_EMAIL` | Email for Let's Encrypt certificate registration and expiry notices                                       |

Set these in `.env` alongside existing app variables (`NEXTAUTH_URL` should use `https://${DOMAIN}`).

Optional DuckDNS (dynamic DNS):

| Variable         | Description            |
| ---------------- | ---------------------- |
| `DUCKDNS_DOMAIN` | DuckDNS subdomain name |
| `DUCKDNS_TOKEN`  | DuckDNS token          |

## First deploy

```bash
cp .env.example .env
# Edit .env: DOMAIN, ACME_EMAIL, NEXTAUTH_URL=https://your-domain, secrets, etc.

docker compose up -d --build
```

Verify:

```bash
curl -fsS "https://${DOMAIN}/api/health"
```

HTTP requests redirect to HTTPS automatically.

## Traefik configuration

Static config: `deploy/traefik/traefik.yml`

- Entrypoints `web` (80) and `websecure` (443)
- `readTimeout: 3600s` on `websecure` for long chunked uploads (mobile and web)
- No body-buffering middleware (uploads stream to the app)
- ACME HTTP-01 challenge on port 80

Router labels on `zee-index` are defined in `docker-compose.yml` and picked up by Traefik's Docker provider.

## Migrating from Caddy

If you previously ran the stack with Caddy:

1. Pull the latest compose files (Caddy service removed).
2. Set `DOMAIN` and `ACME_EMAIL` in `.env`.
3. Update `NEXTAUTH_URL` to `https://${DOMAIN}` if it still points at an old host.
4. Stop the stack and remove Caddy volumes (optional, reclaims disk):

   ```bash
   docker compose down
   docker volume rm zee-index_caddy_data zee-index_caddy_config 2>/dev/null || true
   ```

5. Start with Traefik:

   ```bash
   docker compose up -d --build
   ```

6. Confirm TLS and uploads on staging before cutting over production traffic.

The legacy `Caddyfile` is kept in the repo with a deprecation notice only; it is not mounted by compose.

## Upload proxy notes

Traefik is configured without buffering middleware so resumable uploads pass through without loading entire files into proxy memory. If uploads fail with `408` on slow links, increase `readTimeout` in `deploy/traefik/traefik.yml` (upgrade path documented in that file).
