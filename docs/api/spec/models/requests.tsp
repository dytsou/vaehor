import "@typespec/http";

using TypeSpec.Http;

namespace VaehorApi {
  // =============================================================================
  // Request/response payload models
  // =============================================================================

  model AuthenticateFolderRequest {
    folderId: string;
    id?: string;
    password: string;
  }

  model AuthenticateFolderResponse {
    token?: string;
  }

  model CreateShareLinkRequest {
    path?: string;
    itemName: string;
    type: ShareType;
    expiresIn: string;
    loginRequired?: boolean;
    items?: DriveFile[];
    maxUses?: int32 | null;
    preventDownload?: boolean;
    hasWatermark?: boolean;
    watermarkText?: string | null;
  }

  model CreateShareLinkResponse {
    shareableUrl?: string;
    token?: string;
    jti?: string;
    newShareLink?: ShareLink;
  }

  model ShareTokenRequest {
    shareToken: string;
  }

  model ShareStatusResponse {
    valid?: boolean;
    error?: string;
  }

  model SharedCollectionResponse {
    items?: DriveFile[];
    collectionName?: string;
  }

  model ShareDeleteRequest {
    id: string;
    jti: string;
    expiresAt: string;
  }

  model ShareRevokeRequest {
    jti: string;
    expiresAt: string;
  }

  model RenameFileRequest {
    fileId: string;
    newName: string;
  }

  model DeleteFileRequest {
    fileId: string;
  }

  model EmailRequest {
    email: string;
  }

  model AccessRequestCreateRequest {
    folderId: string;
    folderName: string;
  }

  model FileRequestCreateRequest {
    folderId: string;
    folderName: string;
    title: string;
    expiresIn: int32;
  }

  model FileRequestDeleteRequest {
    token: string;
  }

  model FileRequestUploadInitRequest {
    name: string;
    mimeType: string;
    size: float64;
  }

  model ResumableUploadInitBody {
    name: string;
    mimeType: string;
    parentId: string;
    size: float64;
  }
}
