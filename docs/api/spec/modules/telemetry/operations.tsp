import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Telemetry")
  @get
  @route("/datausage")
  @useAuth(SessionAuth)
  op getDataUsage(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Telemetry")
  @get
  @route("/storage-details")
  @useAuth(SessionAuth)
  op getStorageDetails(): OkResponse<unknown> | UnauthorizedErrorResponse;
}
