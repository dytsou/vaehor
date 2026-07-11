import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Cron")
  @get
  @route("/cron/storage-check")
  op cronStorageCheck(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Cron")
  @get
  @route("/cron/weekly-report")
  op cronWeeklyReport(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Cron")
  @get
  @route("/cron/incident-monitor")
  op cronIncidentMonitor(): OkResponse<unknown> | UnauthorizedErrorResponse;
}
