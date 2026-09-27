import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Setup")
  @get
  @route("/setup/status")
  op getSetupStatus(): OkResponse<SetupStatusResponse>;

  @tag("Setup")
  @get
  @route("/setup/native-callback")
  op nativeSetupOAuthCallback(): NativeSetupCallbackRedirectResponse;

  @tag("Setup")
  @post
  @route("/setup/finish")
  op finishSetup(@body body: unknown): OkResponse<unknown>;

  @tag("Setup")
  @post
  @route("/setup/finish-service-account")
  op finishServiceAccountSetup(@body body: unknown): OkResponse<unknown>;
}
