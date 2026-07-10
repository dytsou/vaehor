import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";
import "../../models/domain.tsp";
import "../../models/requests.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Auth")
  @get
  @route("/auth/me")
  @doc("Get the currently authenticated user's information.")
  @useAuth(SessionAuth)
  op getCurrentUser(): OkResponse<User> | UnauthorizedErrorResponse;

  @tag("Auth")
  @post
  @route("/auth/folder")
  @doc("Submit credentials to access a protected folder.")
  op authenticateFolder(
    @body body: AuthenticateFolderRequest,
  ): OkResponse<AuthenticateFolderResponse> | UnauthorizedErrorResponse;

  @tag("Auth")
  @get
  @route("/auth/status")
  op getAuthStatus(): OkResponse<unknown>;

  @tag("Auth")
  @post
  @route("/auth/local/check")
  op localAuthCheck(@body body: unknown): OkResponse<unknown>;

  @tag("Auth")
  @post
  @route("/auth/local/unlock")
  op localAuthUnlock(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Auth")
  @post
  @route("/auth/local/logout")
  @useAuth(SessionAuth)
  op localAuthLogout(): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Auth")
  @get
  @route("/auth/2fa/status")
  @useAuth(SessionAuth)
  op get2faStatus(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Auth")
  @post
  @route("/auth/2fa/generate")
  @useAuth(SessionAuth)
  op generate2faSecret(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Auth")
  @post
  @route("/auth/2fa/verify")
  @useAuth(SessionAuth)
  op verify2faCode(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Auth")
  @post
  @route("/auth/2fa/disable")
  @useAuth(SessionAuth)
  op disable2fa(): OkResponse<unknown> | UnauthorizedErrorResponse;

  // NextAuth handler documented as a placeholder (catch-all routes are not modeled precisely)
  @tag("Auth")
  @route("/auth/{nextauth}")
  op nextAuthHandler(@path nextauth: string): OkResponse<unknown>;

  @tag("Auth")
  @post
  @route("/request-access")
  @useAuth(SessionAuth)
  op requestFolderAccess(
    @body body: AccessRequestCreateRequest,
  ): OkResponse<unknown> | UnauthorizedErrorResponse | ForbiddenErrorResponse;
}
