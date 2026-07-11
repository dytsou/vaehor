import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

import "./models/index.tsp";
import "./modules/index.tsp";

using TypeSpec.Http;

@service(#{ title: "vaehor API" })
@server("http://localhost:3000", "Development server")
@server("https://zee-index.duckdns.org", "Production server")
@route("/api")
namespace VaehorApi;
