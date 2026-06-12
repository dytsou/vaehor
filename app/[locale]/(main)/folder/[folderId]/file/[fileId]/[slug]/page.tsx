import { getAnyFileDetails, listAllFiles } from "@/lib/storage";
import FileDetailClient from "@/components/file-browser/FileDetailClient";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import {
  isPrivateFolder,
  isProtected,
  hasUserAccess,
  verifyShareTokenString,
} from "@/lib/auth";
import type { SubtitleTrack } from "@/lib/subtitles";
import type { ZeeFile } from "@/types/storage";
import type { Session } from "next-auth";

const FileError = ({
  message,
  title,
  retry,
}: {
  message: string;
  title: string;
  retry: string;
}) => (
  <div className="text-center py-20 text-muted-foreground">
    <h1 className="text-4xl font-bold">{title}</h1>
    <p className="mt-4 mb-6">{message}</p>
    <a
      href="/"
      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium transition-colors"
    >
      {retry}
    </a>
  </div>
);

const createSlug = (name: string) =>
  encodeURIComponent(name.replace(/\s+/g, "-").toLowerCase());

type FilePageParams = {
  folderId: string;
  fileId: string;
  locale: string;
};

type FilePageLoadResult = {
  file: ZeeFile | null;
  prevFileUrl?: string;
  nextFileUrl?: string;
  subtitleTracks: SubtitleTrack[];
  error: string | null;
};

async function userCanAccessFolder(
  folderId: string,
  session: Session | null,
): Promise<boolean> {
  if (session?.user?.role === "ADMIN") return true;

  const userEmail = session?.user?.email;
  if (userEmail && (await hasUserAccess(userEmail, folderId))) return true;

  const isPriv = isPrivateFolder(folderId);
  const isProt = await isProtected(folderId);
  return !isPriv && !isProt;
}

async function getAccessDeniedResponse(
  shareToken: string | undefined,
  folderId: string,
  session: Session | null,
) {
  if (shareToken) {
    const isValidShare = await verifyShareTokenString(shareToken);
    if (!isValidShare) {
      return (
        <FileError
          title="Access Denied"
          message="Invalid share token or login required."
          retry="Go Home"
        />
      );
    }
    return null;
  }

  if (!(await userCanAccessFolder(folderId, session))) {
    return (
      <FileError
        title="Access Denied"
        message="You do not have permission to view this file."
        retry="Go Home"
      />
    );
  }

  return null;
}

function buildFilePageUrl(
  locale: string,
  folderId: string,
  file: ZeeFile,
): string {
  return `/${locale}/folder/${folderId}/file/${file.id}/${createSlug(file.name)}`;
}

function getNavigationUrls(
  params: FilePageParams,
  nonFolderFiles: ZeeFile[],
): { prevFileUrl?: string; nextFileUrl?: string } {
  const currentIndex = nonFolderFiles.findIndex((f) => f.id === params.fileId);
  if (currentIndex === -1) return {};

  const navigation: { prevFileUrl?: string; nextFileUrl?: string } = {};

  if (currentIndex > 0) {
    navigation.prevFileUrl = buildFilePageUrl(
      params.locale,
      params.folderId,
      nonFolderFiles[currentIndex - 1],
    );
  }

  if (currentIndex < nonFolderFiles.length - 1) {
    navigation.nextFileUrl = buildFilePageUrl(
      params.locale,
      params.folderId,
      nonFolderFiles[currentIndex + 1],
    );
  }

  return navigation;
}

const SUBTITLE_EXTENSIONS = [".vtt", ".srt"];

function isSubtitleFile(file: ZeeFile, baseName: string): boolean {
  const fileName = file.name.toLowerCase();
  const ext = file.name.substring(file.name.lastIndexOf("."));
  return (
    !file.isFolder &&
    SUBTITLE_EXTENSIONS.includes(ext.toLowerCase()) &&
    fileName.startsWith(baseName.toLowerCase())
  );
}

function toSubtitleTrack(trackFile: ZeeFile): SubtitleTrack {
  const langMatch = trackFile.name.match(/[\._]([a-z]{2,3})[\._]/i);
  const lang = langMatch ? langMatch[1] : "en";

  return {
    src: `/api/download?fileId=${trackFile.id}`,
    kind: "subtitles",
    srcLang: lang,
    label: lang.toUpperCase(),
    default: lang === "en",
  };
}

function getSubtitleTracks(
  file: ZeeFile,
  allFiles: ZeeFile[],
): SubtitleTrack[] {
  if (!file.mimeType.startsWith("video/")) return [];

  const baseName =
    file.name.substring(0, file.name.lastIndexOf(".")) || file.name;

  const rawTracks = allFiles
    .filter((f) => isSubtitleFile(f, baseName))
    .map(toSubtitleTrack);

  return Array.from(new Map(rawTracks.map((t) => [t.label, t])).values());
}

async function loadFilePageData(
  params: FilePageParams,
  t: Awaited<ReturnType<typeof getTranslations>>,
): Promise<FilePageLoadResult> {
  try {
    const file = await getAnyFileDetails(params.fileId);
    if (!file || !params.folderId) {
      return { file, subtitleTracks: [], error: null };
    }

    const { files: allFiles } = await listAllFiles({
      folderId: params.folderId,
      pageToken: null,
      pageSize: 1000,
      useCache: true,
    });

    const nonFolderFiles = allFiles.filter((f) => !f.isFolder);

    return {
      file,
      ...getNavigationUrls(params, nonFolderFiles),
      subtitleTracks: getSubtitleTracks(file, allFiles),
      error: null,
    };
  } catch (err) {
    console.error("Fetch file details error:", err);
    return { file: null, subtitleTracks: [], error: t("fetchError") };
  }
}

export default async function FilePage(props: {
  params: Promise<{ folderId: string; fileId: string; locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const t = await getTranslations("FilePage");

  const session = await auth();
  const shareToken = searchParams?.share_token as string | undefined;

  const accessDenied = await getAccessDeniedResponse(
    shareToken,
    params.folderId,
    session,
  );
  if (accessDenied) return accessDenied;

  const { file, prevFileUrl, nextFileUrl, subtitleTracks, error } =
    await loadFilePageData(params, t);

  if (error) {
    return (
      <FileError message={error} title={t("errorTitle")} retry={t("retry")} />
    );
  }

  if (!file) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <h1 className="text-4xl font-bold">{t("notFoundTitle")}</h1>
        <p className="mt-4 mb-6">{t("notFoundMessage")}</p>
        <a
          href=""
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium transition-colors"
        >
          {t("retry")}
        </a>
      </div>
    );
  }

  return (
    <FileDetailClient
      file={file}
      prevFileUrl={prevFileUrl}
      nextFileUrl={nextFileUrl}
      subtitleTracks={subtitleTracks}
      currentFolderId={params.folderId}
    />
  );
}
