import "@typespec/http";
import "../../models/index.tsp";

using TypeSpec.Http;

namespace VaehorApi {
  model SetupStatusResponse {
    requiresSetupToken: boolean;
  }

  model NativeSetupCallbackRedirectResponse {
    @statusCode statusCode: 302;
    @header("Location") location: string;
  }
}
