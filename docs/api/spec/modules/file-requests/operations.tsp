import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";
import "../../models/domain.tsp";
import "../../models/requests.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("FileRequests")
  @post
  @route("/file-request")
  op createFileRequest(
    @body body: FileRequestCreateRequest,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("FileRequests")
  @get
  @route("/file-request/{token}")
  op getFileRequest(@path token: string): OkResponse<unknown>;

  @tag("FileRequests")
  @post
  @route("/file-request/upload")
  op uploadToFileRequest(
    @query type: UploadMode,
    @query token: string,
    @query uploadUrl?: string,
    @header contentRange?: string,
    @body body: FileRequestUploadInitRequest | bytes,
  ): OkResponse<unknown> | ForbiddenErrorResponse;
}
