import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace ZeeIndexApi {
  @tag("Mobile")
  @get
  @route("/mobile/oauth-state")
  @doc("Create a one-time OAuth state for Capacitor native Google sign-in.")
  op createMobileOAuthState(): OkResponse<MobileOAuthStateResponse>;

  @tag("Mobile")
  @get
  @route("/mobile/oauth-complete")
  @doc("Finish browser OAuth: validate state, mint exchange token, redirect to zeeindex://auth/callback.")
  @useAuth(SessionAuth)
  op completeMobileOAuthGet(
    @query state: string,
  ): RedirectResponse | UnauthorizedErrorResponse;

  @tag("Mobile")
  @post
  @route("/mobile/oauth-complete")
  @doc("Redeem exchange token from the custom-scheme callback; returns bootstrap material for the shell.")
  op completeMobileOAuthPost(
    @body body: MobileOAuthCompleteBody,
  ): OkResponse<MobileOAuthCompleteResponse> | UnauthorizedErrorResponse;

  @tag("Mobile")
  @get
  @route("/mobile/session-bootstrap")
  @doc("Redeem bootstrap token via redirect and set the NextAuth session cookie in the WebView.")
  op bootstrapMobileSessionGet(
    @query token: string,
    @query redirect?: string,
  ): RedirectResponse | UnauthorizedErrorResponse;

  @tag("Mobile")
  @post
  @route("/mobile/session-bootstrap")
  @doc("Mint a bootstrap URL from a session token, or redeem a bootstrap token for a session token (native shell).")
  op bootstrapMobileSessionPost(
    @body
    body: MobileSessionBootstrapMintBody | MobileSessionBootstrapRedeemBody,
  ): OkResponse<MobileSessionBootstrapMintResponse | MobileSessionBootstrapRedeemResponse> | UnauthorizedErrorResponse;
}
