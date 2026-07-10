# vaehor API Documentation

## Overview

This folder contains the maintained API reference for vaehor.

- `spec/entry.tsp` is the **source of truth** (TypeSpec entrypoint).
- TypeSpec is organized into:
  - `spec/models/**` (shared schemas used across the API)
  - `spec/modules/**` (feature modules; each module has `models.tsp` + `operations.tsp`)
- `openapi.yaml` is **generated** from TypeSpec.
- The complete route inventory lives under `app/api/**` (not all routes are guaranteed documented yet).

## How to View the OpenAPI Spec

1. Swagger UI

   ```bash
   # Use the online editor
   # https://editor.swagger.io/
   ```

2. Redoc

   ```bash
   # Compiles TypeSpec → OpenAPI, builds static Redoc HTML, opens it in the browser
   pnpm api:docs:redoc
   ```

   (`@redocly/cli` v2 removed `preview-docs`; this script uses `build-docs` instead.)

3. Postman

   Run `pnpm api:compile` and import `docs/api/openapi.yaml`.

## How to Generate OpenAPI

```bash
pnpm compile:openapi
```

## Route Inventory

### Authentication

| Method | Endpoint                  | Description                           |
| ------ | ------------------------- | ------------------------------------- |
| GET    | `/api/auth/me`            | Return the current authenticated user |
| POST   | `/api/auth/folder`        | Unlock a protected folder             |
| GET    | `/api/auth/2fa/status`    | Read 2FA status for the current user  |
| POST   | `/api/auth/2fa/generate`  | Generate a new 2FA secret             |
| POST   | `/api/auth/2fa/verify`    | Verify a 2FA code                     |
| POST   | `/api/auth/2fa/disable`   | Disable 2FA for the current user      |
| `*`    | `/api/auth/[...nextauth]` | NextAuth handler route                |

### Mobile (Capacitor)

| Method | Endpoint                        | Description                                              |
| ------ | ------------------------------- | -------------------------------------------------------- |
| GET    | `/api/mobile/oauth-state`       | Create one-time OAuth state for native Google sign-in    |
| GET    | `/api/mobile/oauth-complete`    | Finish browser OAuth → redirect `vaehor://auth/callback` |
| POST   | `/api/mobile/oauth-complete`    | Redeem exchange token → bootstrap material               |
| GET    | `/api/mobile/session-bootstrap` | Redeem bootstrap token via redirect + set session cookie |
| POST   | `/api/mobile/session-bootstrap` | Mint bootstrap URL or redeem bootstrap token             |

Canonical definitions: TypeSpec `docs/api/spec/modules/mobile/` → `docs/api/openapi.yaml` (tag **Mobile**).

### Files and Search

| Method | Endpoint                        | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| GET    | `/api/files`                    | List folder contents                 |
| GET    | `/api/filedetails`              | Read file metadata                   |
| GET    | `/api/download`                 | Stream or download a file            |
| GET    | `/api/search`                   | Search within Drive content          |
| GET    | `/api/search/global`            | Global search endpoint               |
| POST   | `/api/files/upload`             | Upload a file                        |
| PATCH  | `/api/files/rename`             | Rename a file                        |
| PATCH  | `/api/files/move`               | Move a file                          |
| POST   | `/api/files/copy`               | Copy a file                          |
| POST   | `/api/files/bulk-move`          | Move multiple files                  |
| POST   | `/api/files/bulk-delete`        | Delete multiple files                |
| DELETE | `/api/files/delete`             | Delete a file                        |
| PATCH  | `/api/files/update`             | Update metadata                      |
| PATCH  | `/api/files/update-media`       | Update media-specific metadata       |
| GET    | `/api/files/[fileId]/revisions` | Read revision history                |
| POST   | `/api/folder/create`            | Create a folder                      |
| GET    | `/api/folderpath`               | Resolve breadcrumb path              |
| POST   | `/api/bulk-download`            | Download multiple files              |
| GET    | `/api/archive-preview`          | Preview archive contents             |
| GET    | `/api/proxy-image`              | Proxy remote image previews          |
| GET    | `/api/metadata`                 | Resolve metadata for embeds/previews |
| GET    | `/api/trash`                    | Read trash data                      |

### Share

| Method | Endpoint                     | Description                                        |
| ------ | ---------------------------- | -------------------------------------------------- |
| POST   | `/api/share`                 | Create a share link or shared collection           |
| GET    | `/api/share/list`            | List share links                                   |
| POST   | `/api/share/delete`          | Delete a share link and remove it from persistence |
| POST   | `/api/share/revoke`          | Block a share token without deleting the record    |
| POST   | `/api/share/status`          | Validate whether a share token is still active     |
| POST   | `/api/share/track`           | Increment share view counters                      |
| GET    | `/api/share/items/[shareId]` | Resolve the items of a shared collection           |

### Public Config and Setup

| Method | Endpoint             | Description                          |
| ------ | -------------------- | ------------------------------------ |
| GET    | `/api/config/public` | Read public-facing app configuration |
| POST   | `/api/setup/finish`  | Finish initial setup                 |
| GET    | `/api/health`        | Public health endpoint               |

### Admin

| Method | Endpoint                        | Description                              |
| ------ | ------------------------------- | ---------------------------------------- |
| GET    | `/api/admin/config`             | Read app configuration                   |
| POST   | `/api/admin/config`             | Update app configuration                 |
| GET    | `/api/admin/system-health`      | Operational dependency and error metrics |
| GET    | `/api/admin/stats`              | Aggregated dashboard statistics          |
| GET    | `/api/admin/cache-stats`        | Cache and in-memory stats                |
| GET    | `/api/admin/activity-log`       | Activity log data                        |
| GET    | `/api/admin/logs`               | Application logs                         |
| GET    | `/api/admin/logs/security`      | Security log feed                        |
| GET    | `/api/admin/analytics`          | Analytics dashboard data                 |
| GET    | `/api/admin/analytics/enhanced` | Enhanced analytics                       |
| POST   | `/api/admin/analytics/track`    | Client analytics ingestion               |
| GET    | `/api/admin/users`              | List admins                              |
| POST   | `/api/admin/users`              | Add an admin                             |
| DELETE | `/api/admin/users`              | Remove an admin                          |
| GET    | `/api/admin/editors`            | List editors                             |
| POST   | `/api/admin/editors`            | Add an editor                            |
| DELETE | `/api/admin/editors`            | Remove an editor                         |
| GET    | `/api/admin/protected-folders`  | List protected folders                   |
| POST   | `/api/admin/protected-folders`  | Update protected folders                 |
| GET    | `/api/admin/access-requests`    | List folder access requests              |
| GET    | `/api/admin/user-access`        | Inspect user access                      |
| POST   | `/api/admin/user-password`      | Rotate user password                     |
| GET    | `/api/admin/manual-drives`      | List manually added drives               |
| POST   | `/api/admin/manual-drives`      | Add a manual drive                       |
| POST   | `/api/admin/drives/scan`        | Scan shared drives                       |
| GET    | `/api/admin/audit`              | Audit data                               |

### File Requests and Jobs

| Method | Endpoint                     | Description                          |
| ------ | ---------------------------- | ------------------------------------ |
| POST   | `/api/file-request`          | Create a file request                |
| GET    | `/api/file-request/[token]`  | Resolve a request by token           |
| POST   | `/api/file-request/upload`   | Upload into a request                |
| POST   | `/api/request-access`        | Request access to a protected folder |
| GET    | `/api/cron/storage-check`    | Scheduled storage audit              |
| GET    | `/api/cron/weekly-report`    | Scheduled report generation          |
| GET    | `/api/cron/incident-monitor` | Scheduled incident rule evaluation   |

## Authentication

Most endpoints use one of these mechanisms:

- NextAuth session cookie
- `share_token` query string for shared links
- `access_token` query string or `Authorization: Bearer <token>` for protected folders

## Rate Limits

The API layer is standardized through the route factory in [`lib/api-middleware.ts`](/C:/Users/Ifauze/Project/vaehor/lib/api-middleware.ts).

| Scope       | Limit                   |
| ----------- | ----------------------- |
| General API | 500 requests / minute   |
| Download    | 100 requests / hour     |
| Auth        | 20 requests / 5 minutes |
| Admin       | 50 requests / minute    |

Some public and internal endpoints explicitly disable route-factory rate limiting when a different protection model is used.

## Error Format

Most endpoints return:

```json
{
  "error": "Human readable message"
}
```

Some standardized handlers may also return:

```json
{
  "error": "Human readable message",
  "details": []
}
```

Every route created through the shared API middleware includes an `X-Request-Id` response header for tracing.

## Practical Examples

### List files

```bash
curl -X GET "http://localhost:3000/api/files?folderId=<folder-id>"
```

### Create a share link

```bash
curl -X POST "http://localhost:3000/api/share" \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<token>" \
  -d '{
    "path": "/folder/<folder-id>",
    "itemName": "My Folder",
    "type": "timed",
    "expiresIn": "7d",
    "loginRequired": false
  }'
```

### Validate public health

```bash
curl -X GET "http://localhost:3000/api/health"
```
