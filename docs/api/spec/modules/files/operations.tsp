import "@typespec/http";
import "@typespec/openapi";

import "./models.tsp";
import "../../models/common.tsp";
import "../../models/domain.tsp";
import "../../models/requests.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace VaehorApi {
  @tag("Files")
  @get
  @route("/files")
  @doc("Get a paginated list of files and folders within a specified folder.")
  @useAuth(OptionalMobileAuth)
  op listFiles(
    @query folderId: string,
    @query pageSize?: int32,
    @query pageToken?: string,
    @query share_token?: string,
    @header("X-Folder-Access-Token") xFolderAccessToken?: string,
    @header("X-Local-Storage-Token") xLocalStorageToken?: string,
  ): OkResponse<FileListResponse> | UnauthorizedErrorResponse | NotFoundErrorResponse;

  @tag("Files")
  @get
  @route("/filedetails")
  @doc("Get detailed metadata for a specific file.")
  @useAuth(OptionalMobileAuth)
  op getFileDetails(
    @query fileId: string,
    @query share_token?: string,
    @header("X-Folder-Access-Token") xFolderAccessToken?: string,
    @header("X-Local-Storage-Token") xLocalStorageToken?: string,
  ): OkResponse<DriveFile> | UnauthorizedErrorResponse | NotFoundErrorResponse;

  @tag("Files")
  @get
  @route("/download")
  @doc("Initiate file download from Google Drive.")
  @useAuth(OptionalMobileAuth)
  op downloadFile(
    @query fileId: string,
    @query share_token?: string,
    @query access_token?: string,
    @header("X-Folder-Access-Token") xFolderAccessToken?: string,
    @header("X-Local-Storage-Token") xLocalStorageToken?: string,
  ):
    | OkResponse<bytes>
    | RedirectResponse
    | UnauthorizedErrorResponse
    | NotFoundErrorResponse;

  @tag("Files")
  @get
  @route("/search")
  @doc("Search for files within a folder.")
  @useAuth(OptionalMobileAuth)
  op searchFiles(
    @query q: string,
    @query folderId: string,
    @query type?: SearchType,
    @query share_token?: string,
    @header("X-Folder-Access-Token") xFolderAccessToken?: string,
    @header("X-Local-Storage-Token") xLocalStorageToken?: string,
  ): OkResponse<DriveFile[]> | UnauthorizedErrorResponse;

  @tag("Files")
  @post
  @route("/files/upload")
  @doc("Initialize or send a chunk for an upload by an authenticated user with upload access.")
  @useAuth(MobileAuth)
  op uploadFile(
    @query type: UploadMode,
    @query uploadUrl?: string,
    @query parentId?: string,
    @header contentRange?: string,
    @header("X-Folder-Access-Token") xFolderAccessToken?: string,
    @header("X-Local-Storage-Token") xLocalStorageToken?: string,
    @body body: ResumableUploadInitBody | bytes,
  ): EmptyOkResponse | UnauthorizedErrorResponse | ForbiddenErrorResponse;

  @tag("Files")
  @patch
  @route("/files/rename")
  @doc("Rename a file or folder with the required server-side permission.")
  @useAuth(MobileAuth)
  op renameFile(
    @body body: RenameFileRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Files")
  @delete
  @route("/files/delete")
  @doc("Move a file to trash with the required server-side permission.")
  @useAuth(MobileAuth)
  op deleteFile(
    @body body: DeleteFileRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  // --- Remaining mutations & utilities ---

  @tag("Files")
  @post
  @route("/files/move")
  @useAuth(MobileAuth)
  op moveFile(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @post
  @route("/files/copy")
  @useAuth(MobileAuth)
  op copyFile(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @post
  @route("/files/bulk-move")
  @useAuth(MobileAuth)
  op bulkMoveFiles(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @post
  @route("/files/bulk-delete")
  @useAuth(MobileAuth)
  op bulkDeleteFiles(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @patch
  @route("/files/update")
  @useAuth(MobileAuth)
  op updateFileMetadata(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @patch
  @route("/files/update-media")
  @useAuth(MobileAuth)
  op updateFileMedia(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @get
  @route("/files/{fileId}/revisions")
  @useAuth(MobileAuth)
  op listFileRevisions(
    @path fileId: string,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @get
  @route("/search/global")
  @useAuth(MobileAuth)
  op globalSearch(@query q: string): OkResponse<unknown>;

  @tag("Files")
  @post
  @route("/folder/create")
  @useAuth(MobileAuth)
  op createFolder(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @get
  @route("/folderpath")
  @useAuth(OptionalMobileAuth)
  op getFolderPath(@query folderId: string): OkResponse<unknown>;

  @tag("Files")
  @get
  @route("/trash")
  @useAuth(MobileAuth)
  op getTrash(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @get
  @route("/metadata")
  @useAuth(OptionalMobileAuth)
  op getMetadata(@query url?: string, @query id?: string): OkResponse<unknown>;

  @tag("Files")
  @get
  @route("/archive-preview")
  @useAuth(OptionalMobileAuth)
  op archivePreview(
    @query fileId: string,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;
}
