import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";
import "../../models/domain.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Health")
  @get
  @route("/health")
  @doc("Check the health status of the application and its dependencies.")
  op healthCheck(): OkResponse<HealthResponse> | ServiceUnavailableResponse;
}
