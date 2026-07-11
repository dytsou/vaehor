import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Config")
  @get
  @route("/config")
  op getConfigLegacy(): OkResponse<unknown>;

  @tag("Config")
  @get
  @route("/config/public")
  op getPublicConfig(): OkResponse<unknown>;
}
