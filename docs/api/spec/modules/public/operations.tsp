import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Public")
  @get
  @route("/proxy-image")
  op proxyImage(@query url: string): OkResponse<unknown>;

  @tag("Public")
  @get
  @route("/og")
  op getOpenGraphImage(@query title?: string): OkResponse<unknown>;

  @tag("Public")
  @post
  @route("/bulk-download")
  @doc("Download selected files as a ZIP archive. The aggregate uncompressed response is limited to 50 MiB.")
  @useAuth(SessionAuth)
  op bulkDownload(
    @body body: unknown,
  ):
    OkResponse<unknown>
    | UnauthorizedErrorResponse
    | PayloadTooLargeErrorResponse;
}
