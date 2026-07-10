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
  op listFiles(
    @query folderId: string,
    @query pageSize?: int32,
    @query pageToken?: string,
    @query share_token?: string,
  ): OkResponse<FileListResponse> | UnauthorizedErrorResponse | NotFoundErrorResponse;

  @tag("Files")
  @get
  @route("/filedetails")
  @doc("Get detailed metadata for a specific file.")
  op getFileDetails(@query fileId: string): OkResponse<DriveFile>;

  @tag("Files")
  @get
  @route("/download")
  @doc("Initiate file download from Google Drive.")
  op downloadFile(
    @query fileId: string,
    @query share_token?: string,
    @query access_token?: string,
  ):
    | OkResponse<unknown>
    | RedirectResponse
    | UnauthorizedErrorResponse
    | NotFoundErrorResponse;

  @tag("Files")
  @get
  @route("/search")
  @doc("Search for files within a folder.")
  op searchFiles(
    @query q: string,
    @query folderId: string,
    @query type?: SearchType,
  ): OkResponse<DriveFile[]>;

  @tag("Files")
  @post
  @route("/files/upload")
  @doc("Upload a file to Google Drive (Admin only).")
  op uploadFile(
    @query type: UploadMode,
    @query uploadUrl?: string,
    @query parentId?: string,
    @header contentRange?: string,
    @body body: ResumableUploadInitBody | bytes,
  ): EmptyOkResponse | UnauthorizedErrorResponse | ForbiddenErrorResponse;

  @tag("Files")
  @patch
  @route("/files/rename")
  @doc("Rename a file or folder (Admin only).")
  op renameFile(
    @body body: RenameFileRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  @tag("Files")
  @delete
  @route("/files/delete")
  @doc("Move file to trash (Admin only).")
  op deleteFile(
    @body body: DeleteFileRequest,
  ): EmptyOkResponse | UnauthorizedErrorResponse;

  // --- Remaining mutations & utilities ---

  @tag("Files")
  @post
  @route("/files/move")
  @useAuth(SessionAuth)
  op moveFile(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @post
  @route("/files/copy")
  @useAuth(SessionAuth)
  op copyFile(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @post
  @route("/files/bulk-move")
  @useAuth(SessionAuth)
  op bulkMoveFiles(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @post
  @route("/files/bulk-delete")
  @useAuth(SessionAuth)
  op bulkDeleteFiles(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @patch
  @route("/files/update")
  @useAuth(SessionAuth)
  op updateFileMetadata(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @patch
  @route("/files/update-media")
  @useAuth(SessionAuth)
  op updateFileMedia(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @get
  @route("/files/{fileId}/revisions")
  @useAuth(SessionAuth)
  op listFileRevisions(
    @path fileId: string,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @get
  @route("/search/global")
  op globalSearch(@query q: string): OkResponse<unknown>;

  @tag("Files")
  @post
  @route("/folder/create")
  @useAuth(SessionAuth)
  op createFolder(
    @body body: unknown,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @get
  @route("/folderpath")
  op getFolderPath(@query folderId: string): OkResponse<unknown>;

  @tag("Files")
  @get
  @route("/trash")
  @useAuth(SessionAuth)
  op getTrash(): OkResponse<unknown> | UnauthorizedErrorResponse;

  @tag("Files")
  @get
  @route("/metadata")
  op getMetadata(@query url?: string, @query id?: string): OkResponse<unknown>;

  @tag("Files")
  @get
  @route("/archive-preview")
  @useAuth(SessionAuth)
  op archivePreview(
    @query fileId: string,
  ): OkResponse<unknown> | UnauthorizedErrorResponse;
}
