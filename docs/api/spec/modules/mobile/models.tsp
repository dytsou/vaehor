import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  model MobileDrive {
    id: string;
    name: string;
    isProtected: boolean;
  }

  model MobileDrivesResponse {
    rootFolderId: string;
    drives: MobileDrive[];
    role: string;
  }

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

  model MobileLocalStorageUnlockBody {
    password: string;
  }

  model MobileLocalStorageUnlockResponse {
    success: boolean;
    protected: boolean;
    token?: string;
  }

  model MobileFavoriteFile {
    id: string;
    name?: string;
    mimeType?: string;
    size?: string;
    modifiedTime?: string;
    createdTime?: string;
    isFolder?: boolean;
    isProtected?: boolean;
    @doc("The nearest protected folder that gates access to this favorite, when applicable.")
    protectedFolderId?: string;
    parents?: string[];
    trashed?: boolean;
  }

  model MobileFavoritesResponse {
    files: MobileFavoriteFile[];
    nextPageToken?: string;
  }

  model MobileFavoriteIdsResponse {
    favoriteIds: string[];
  }

  model MobileFavoriteUpdateBody {
    fileId: string;
    isFavorite: boolean;
  }

  model MobileFavoriteUpdateResponse {
    success: boolean;
    isFavorite: boolean;
  }

  model MobilePinnedFolder {
    id: string;
    name?: string;
    mimeType?: string;
    parents?: string[];
  }

  model MobilePinnedFoldersResponse {
    folders: MobilePinnedFolder[];
  }

  model MobilePinBody {
    folderId: string;
  }

  model MobilePinMutationResponse {
    success: boolean;
    isPinned: boolean;
  }

  model MobileTagsResponse {
    tags: string[];
  }

  model MobileTagBody {
    fileId: string;
    tag: string;
  }

  model MobileTagMutationResponse {
    success: boolean;
  }
}
