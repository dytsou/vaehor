import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  // =============================================================================
  // Common models
  // =============================================================================

  model ErrorResponse {
    error: string;
  }

  model ErrorWithDetails {
    error: string;
    details: unknown[];
  }

  model OkResponse<T> {
    @statusCode statusCode: 200;
    @body body: T;
  }

  model NoContentResponse {
    @statusCode statusCode: 204;
  }

  model EmptyOkResponse {
    @statusCode statusCode: 200;
  }

  model UnauthorizedResponse {
    @statusCode statusCode: 401;
  }

  model ForbiddenResponse {
    @statusCode statusCode: 403;
  }

  model NotFoundResponse {
    @statusCode statusCode: 404;
  }

  model RedirectResponse {
    @statusCode statusCode: 302;
  }

  model ServiceUnavailableResponse {
    @statusCode statusCode: 503;
  }

  /**
   * Mirrors the legacy OpenAPI error shape used across the app.
   */
  model Error {
    error?: string;
    details?: string | unknown[];
  }

  model UnauthorizedErrorResponse {
    @statusCode statusCode: 401;
    @body body: Error;
  }

  model ForbiddenErrorResponse {
    @statusCode statusCode: 403;
    @body body: Error;
  }

  model NotFoundErrorResponse {
    @statusCode statusCode: 404;
    @body body: Error;
  }

  model ServiceUnavailableErrorResponse {
    @statusCode statusCode: 503;
    @body body: Error;
  }

  alias SessionAuth = ApiKeyAuth<
    ApiKeyLocation.cookie,
    "next-auth.session-token"
  >;
}
