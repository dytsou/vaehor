import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Mobile")
  @get
  @route("/mobile/drives")
  @doc("List the configured file roots available to the signed-in mobile user.")
  @useAuth(MobileAuth)
  op listMobileDrives():
    OkResponse<MobileDrivesResponse>
    | UnauthorizedErrorResponse
    | ServiceUnavailableErrorResponse;

  @tag("Mobile")
  @get
  @route("/mobile/favorites")
  @doc("List a page of the signed-in user's favorite files, or only their IDs for native-client state.")
  @useAuth(MobileAuth)
  op listMobileFavorites(
    @query idsOnly?: boolean,
    @query pageToken?: string,
  ):
    OkResponse<MobileFavoritesResponse | MobileFavoriteIdsResponse>
    | UnauthorizedErrorResponse
    | ServiceUnavailableErrorResponse;

  @tag("Mobile")
  @post
  @route("/mobile/favorites")
  @doc("Add or remove a favorite for the signed-in native user.")
  @useAuth(MobileAuth)
  op setMobileFavorite(
    @body body: MobileFavoriteUpdateBody,
  ):
    OkResponse<MobileFavoriteUpdateResponse>
    | UnauthorizedErrorResponse
    | ServiceUnavailableErrorResponse;

  @tag("Mobile")
  @get
  @route("/mobile/pins")
  @doc("List pinned folders for the signed-in native user.")
  @useAuth(MobileAuth)
  op listMobilePinnedFolders():
    OkResponse<MobilePinnedFoldersResponse>
    | UnauthorizedErrorResponse
    | ServiceUnavailableErrorResponse;

  @tag("Mobile")
  @post
  @route("/mobile/pins")
  @doc("Pin a folder. Requires the server administrator role.")
  @useAuth(MobileAuth)
  op addMobilePin(
    @body body: MobilePinBody,
  ): OkResponse<MobilePinMutationResponse> | UnauthorizedErrorResponse | ForbiddenErrorResponse;

  @tag("Mobile")
  @delete
  @route("/mobile/pins")
  @doc("Unpin a folder. Requires the server administrator role.")
  @useAuth(MobileAuth)
  op removeMobilePin(
    @body body: MobilePinBody,
  ): OkResponse<MobilePinMutationResponse> | UnauthorizedErrorResponse | ForbiddenErrorResponse;

  @tag("Mobile")
  @get
  @route("/mobile/tags")
  @doc("Read tags for a file available to the signed-in native user.")
  @useAuth(MobileAuth)
  op listMobileTags(
    @query fileId: string,
  ): OkResponse<MobileTagsResponse> | UnauthorizedErrorResponse | ServiceUnavailableErrorResponse;

  @tag("Mobile")
  @post
  @route("/mobile/tags")
  @doc("Add a file tag. Requires the server administrator role.")
  @useAuth(MobileAuth)
  op addMobileTag(
    @body body: MobileTagBody,
  ): OkResponse<MobileTagMutationResponse> | UnauthorizedErrorResponse | ForbiddenErrorResponse;

  @tag("Mobile")
  @delete
  @route("/mobile/tags")
  @doc("Remove a file tag. Requires the server administrator role.")
  @useAuth(MobileAuth)
  op removeMobileTag(
    @body body: MobileTagBody,
  ): OkResponse<MobileTagMutationResponse> | UnauthorizedErrorResponse | ForbiddenErrorResponse;

  @tag("Mobile")
  @post
  @route("/mobile/local-storage/unlock")
  @doc("Verify local storage access for a signed-in native client and return a short-lived token for SecureStore-backed requests.")
  @useAuth(MobileAuth)
  op unlockMobileLocalStorage(
    @body body: MobileLocalStorageUnlockBody,
  ):
    OkResponse<MobileLocalStorageUnlockResponse>
    | UnauthorizedErrorResponse
    | ForbiddenErrorResponse
    | TooManyRequestsErrorResponse
    | ServiceUnavailableErrorResponse;

  @tag("Mobile")
  @get
  @route("/mobile/oauth-state")
  @doc("Create a one-time OAuth state for React Native Google sign-in through the system browser.")
  op createMobileOAuthState(): OkResponse<MobileOAuthStateResponse>;

  @tag("Mobile")
  @get
  @route("/mobile/oauth-complete")
  @doc("Finish browser OAuth: validate state, mint exchange token, redirect to vaehor://auth/callback.")
  @useAuth(SessionAuth)
  op completeMobileOAuthGet(
    @query state: string,
  ): RedirectResponse | UnauthorizedErrorResponse;

  @tag("Mobile")
  @post
  @route("/mobile/oauth-complete")
  @doc("Redeem the one-time exchange token returned through the native OAuth callback.")
  op completeMobileOAuthPost(
    @body body: MobileOAuthCompleteBody,
  ): OkResponse<MobileOAuthCompleteResponse> | UnauthorizedErrorResponse;

  @tag("Mobile")
  @get
  @route("/mobile/session-bootstrap")
  @doc("Legacy cookie bootstrap for existing web clients. React Native clients use the POST bearer-session exchange.")
  op bootstrapMobileSessionGet(
    @query token: string,
    @query redirect?: string,
  ): RedirectResponse | UnauthorizedErrorResponse;

  @tag("Mobile")
  @post
  @route("/mobile/session-bootstrap")
  @doc("Mint a one-time bootstrap URL or redeem a one-time bootstrap token for a React Native bearer session.")
  op bootstrapMobileSessionPost(
    @body
    body: MobileSessionBootstrapMintBody | MobileSessionBootstrapRedeemBody,
  ): OkResponse<MobileSessionBootstrapMintResponse | MobileSessionBootstrapRedeemResponse> | UnauthorizedErrorResponse;
}
