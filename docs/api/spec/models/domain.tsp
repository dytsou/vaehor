import "@typespec/http";

using TypeSpec.Http;

namespace VaehorApi {
  // =============================================================================
  // Domain models (mirrors docs/api/openapi.yaml + Zod schemas)
  // =============================================================================

  enum UserRole {
    USER,
    ADMIN,
    EDITOR,
    GUEST,
  }

  union UploadMode {
    "init",
    "chunk",
  }

  enum ShareType {
    timed,
    session,
  }

  union SearchType {
    "image",
    "video",
    "audio",
    "document",
    "all",
  }

  enum HealthStatus {
    ok,
    error,
  }

  enum ServiceStatus {
    healthy,
    unhealthy,
    not_configured,
  }

  enum CacheBackend {
    redis,
    memory,
  }

  model ServiceHealth {
    status?: ServiceStatus;
    latency?: int32;
    checkedAt?: utcDateTime;
    error?: string;
  }

  model CacheHealth is ServiceHealth {
    backend?: CacheBackend;
  }

  model GoogleDriveQuota {
    usage?: int32;
    limit?: int32;
  }

  model GoogleDriveHealth is ServiceHealth {
    quota?: GoogleDriveQuota | null;
  }

  model HealthServices {
    database?: ServiceHealth;
    cache?: CacheHealth;
    google_drive?: GoogleDriveHealth;
  }

  model HealthResponse {
    status?: HealthStatus;
    timestamp?: utcDateTime;
    uptime?: float64;
    environment?: string;
    services?: HealthServices;
  }

  model DependencyLatency {
    name?: string;
    latency?: int32;
  }

  model DependencyLatencies {
    database?: int32;
    cache?: int32;
    google_drive?: int32;
  }

  model AdminLatencySummary {
    totalCheckMs?: int32;
    averageDependencyMs?: int32;
    fastestDependency?: DependencyLatency;
    slowestDependency?: DependencyLatency;
    dependencies?: DependencyLatencies;
  }

  model ErrorRateSummary {
    last24h?: int32;
    previous24h?: int32;
    trendPercentage?: float64;
  }

  model AdminSystemHealthResponse {
    status?: HealthStatus;
    timestamp?: utcDateTime;
    services?: HealthServices;
    errorRate?: ErrorRateSummary;
    latency?: AdminLatencySummary;
  }

  model DriveFile {
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string;
    modifiedTime?: utcDateTime;
    createdTime?: utcDateTime;
    isFolder?: boolean;
    hasThumbnail?: boolean;
    thumbnailLink?: string;
    webViewLink?: string;
    parents?: string[];
    trashed?: boolean;
  }

  model FileListResponse {
    files?: DriveFile[];
    nextPageToken?: string;
  }

  model User {
    name?: string;
    email?: string;
    image?: string;
    role?: UserRole;
  }

  model ShareLink {
    id?: string;
    path?: string;
    token?: string;
    jti?: string;
    expiresAt?: utcDateTime;
    loginRequired?: boolean;
    itemName?: string;
    viewCount?: int32;
    isCollection?: boolean;
  }

  model AppConfig {
    hideAuthor?: boolean;
    appName?: string;
    logoUrl?: string;
    faviconUrl?: string;
    primaryColor?: string;
  }

  enum ActivitySeverity {
    info,
    warning,
    error,
    critical,
  }

  model ActivityLog {
    id?: string;
    type?: string;
    timestamp?: int64;
    severity?: ActivitySeverity;
    userEmail?: string;
    itemName?: string;
    status?: string;
    ipAddress?: string;
  }
}
