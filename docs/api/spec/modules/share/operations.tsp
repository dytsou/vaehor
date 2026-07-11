import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";
import "../../models/domain.tsp";
import "../../models/requests.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Share")
  @post
  @route("/share")
  @doc("Create a shareable link for a file or folder (Admin only).")
  op createShareLink(
    @body body: CreateShareLinkRequest,
  ): OkResponse<CreateShareLinkResponse> | UnauthorizedErrorResponse;

  @tag("Share")
  @get
  @route("/share/list")
  @doc("Get all active share links (Admin only).")
  @useAuth(SessionAuth)
  op listShareLinks(): OkResponse<ShareLink[]> | UnauthorizedErrorResponse;

  @tag("Share")
  @post
  @route("/share/delete")
  @doc("Delete a share link (Admin only).")
  op deleteShareLink(
    @body body: ShareDeleteRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Share")
  @post
  @route("/share/revoke")
  @doc("Blocks an existing share token until its original expiry time.")
  op revokeShareLink(
    @body body: ShareRevokeRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Share")
  @post
  @route("/share/status")
  @doc("Validates whether a share token is still usable.")
  op getShareStatus(
    @body body: ShareTokenRequest,
  ): OkResponse<ShareStatusResponse>;

  @tag("Share")
  @post
  @route("/share/track")
  @doc("Increments the view count for a share link.")
  op trackShareAccess(@body body: ShareTokenRequest): NoContentResponse;

  @tag("Share")
  @get
  @route("/share/items/{shareId}")
  @doc("Resolves the items stored for a collection share.")
  op getSharedCollectionItems(
    @path shareId: string,
    @query share_token: string,
  ): OkResponse<SharedCollectionResponse>;
}
