import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace ZeeIndexApi {
  model MobileOAuthStateResponse {
    state: string;
  }

  model MobileOAuthCompleteBody {
    token: string;
  }

  model MobileOAuthCompleteResponse {
    cookieName: string;
    bootstrapToken: string;
  }

  model MobileSessionBootstrapMintBody {
    sessionToken: string;
  }

  model MobileSessionBootstrapRedeemBody {
    bootstrapToken: string;
  }

  model MobileSessionBootstrapMintResponse {
    bootstrapUrl: string;
  }

  model MobileSessionBootstrapRedeemResponse {
    sessionToken: string;
  }
}
