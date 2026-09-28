import JSZip, { type JSZipObject } from "jszip";
import { extensionOf } from "./preview";

export const MAX_CONTAINER_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 500;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_TEXT_ENTRY_BYTES = 512 * 1024;
export const MAX_DOCUMENT_PREVIEW_CHARS = 120_000;

const MAX_DOCUMENT_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_XML_FILE_BYTES = 4 * 1024 * 1024;
const MAX_EPUB_CHAPTERS = 100;
const MAX_PRESENTATION_SLIDES = 40;

const TEXT_ENTRY_EXTENSIONS = new Set([
  "c",
  "cc",
  "conf",
  "cpp",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "html",
  "htm",
  "ini",
  "java",
  "js",
  "json",
  "log",
  "md",
  "mjs",
  "py",
  "rb",
  "rs",
  "sql",
  "srt",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vtt",
  "xml",
  "yaml",
  "yml",
]);

export type DocumentPreviewKind = "archive" | "office" | "epub";

export type ArchivePreviewEntry = {
  path: string;
  size: number;
  isFolder: boolean;
  canPreviewText: boolean;
};

export type EpubPreviewChapter = {
  id: string;
  label: string;
  text: string;
};

export type DocumentPreview =
  | {
      type: "archive";
      entries: ArchivePreviewEntry[];
      readTextEntry: (path: string) => Promise<string>;
    }
  | { type: "text"; text: string }
  | { type: "epub"; title: string; chapters: EpubPreviewChapter[] };

export type DocumentPreviewErrorCode =
  | "file_too_large"
  | "archive_too_large"
  | "too_many_entries"
  | "invalid_archive"
  | "unsupported_document"
  | "no_preview_content";

const ERROR_MESSAGES: Record<DocumentPreviewErrorCode, string> = {
  file_too_large: "This file is too large for in-app preview.",
  archive_too_large: "This archive expands beyond the safe preview limit.",
  too_many_entries: "This archive contains too many items to preview safely.",
  invalid_archive: "This file is damaged or is not a supported archive.",
  unsupported_document:
    "This document format is not supported for in-app preview.",
  no_preview_content: "No readable content was found in this file.",
};

export class DocumentPreviewError extends Error {
  readonly code: DocumentPreviewErrorCode;

  constructor(code: DocumentPreviewErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "DocumentPreviewError";
    this.code = code;
  }
}

type ZipEntryWithSizes = JSZipObject & {
  _data?: { uncompressedSize?: number };
};

type StreamableZipEntry = JSZipObject & {
  internalStream: (type: "uint8array") => JSZip.JSZipStreamHelper<Uint8Array>;
};

const ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const ZIP_CENTRAL_DIGITAL_SIGNATURE = 0x05054b50;
const ZIP_ARCHIVE_EXTRA_DATA_SIGNATURE = 0x08064b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;

function invalidArchive(): never {
  throw new DocumentPreviewError("invalid_archive");
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function readUint64(bytes: Uint8Array, offset: number): number {
  const value =
    readUint32(bytes, offset) + readUint32(bytes, offset + 4) * 0x100000000;
  if (!Number.isSafeInteger(value)) invalidArchive();
  return value;
}

function assertRange(offset: number, length: number, end: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > end
  ) {
    invalidArchive();
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const firstPossibleOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (
    let offset = bytes.length - 22;
    offset >= firstPossibleOffset;
    offset--
  ) {
    if (
      readUint32(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE &&
      offset + 22 + readUint16(bytes, offset + 20) === bytes.length
    ) {
      return offset;
    }
  }
  return invalidArchive();
}

function readZip64EntrySize(
  bytes: Uint8Array,
  extraOffset: number,
  extraLength: number,
  declaredSize: number,
): number {
  const extraEnd = extraOffset + extraLength;
  let size = declaredSize;
  let zip64SizeFound = false;

  for (let offset = extraOffset; offset < extraEnd;) {
    assertRange(offset, 4, extraEnd);
    const identifier = readUint16(bytes, offset);
    const fieldLength = readUint16(bytes, offset + 2);
    const fieldOffset = offset + 4;
    assertRange(fieldOffset, fieldLength, extraEnd);

    if (identifier === 0x0001 && declaredSize === 0xffffffff) {
      if (zip64SizeFound || fieldLength < 8) invalidArchive();
      size = readUint64(bytes, fieldOffset);
      zip64SizeFound = true;
    }
    offset = fieldOffset + fieldLength;
  }

  if (declaredSize === 0xffffffff && !zip64SizeFound) invalidArchive();
  return size;
}

function preflightZip(bytes: Uint8Array): void {
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDiskNumber = readUint16(bytes, endOffset + 6);
  const entriesOnDisk16 = readUint16(bytes, endOffset + 8);
  const totalEntries16 = readUint16(bytes, endOffset + 10);
  const centralSize32 = readUint32(bytes, endOffset + 12);
  const centralOffset32 = readUint32(bytes, endOffset + 16);
  const zip64Required =
    entriesOnDisk16 === 0xffff ||
    totalEntries16 === 0xffff ||
    centralSize32 === 0xffffffff ||
    centralOffset32 === 0xffffffff;

  if (diskNumber !== 0 || centralDiskNumber !== 0) invalidArchive();

  let expectedEntries: number;
  let centralSize: number;
  let centralEnd: number;

  if (zip64Required) {
    const locatorOffset = endOffset - 20;
    assertRange(locatorOffset, 20, bytes.length);
    if (
      readUint32(bytes, locatorOffset) !==
        ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE ||
      readUint32(bytes, locatorOffset + 4) !== 0 ||
      readUint32(bytes, locatorOffset + 16) !== 1
    ) {
      invalidArchive();
    }

    const zip64Offset = readUint64(bytes, locatorOffset + 8);
    assertRange(zip64Offset, 56, locatorOffset);
    if (
      readUint32(bytes, zip64Offset) !==
      ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      invalidArchive();
    }

    const recordSize = readUint64(bytes, zip64Offset + 4);
    if (recordSize < 44 || zip64Offset + 12 + recordSize !== locatorOffset) {
      invalidArchive();
    }
    const zip64DiskNumber = readUint32(bytes, zip64Offset + 16);
    const zip64CentralDiskNumber = readUint32(bytes, zip64Offset + 20);
    const entriesOnDisk = readUint64(bytes, zip64Offset + 24);
    expectedEntries = readUint64(bytes, zip64Offset + 32);
    centralSize = readUint64(bytes, zip64Offset + 40);
    centralEnd = zip64Offset;
    if (
      zip64DiskNumber !== 0 ||
      zip64CentralDiskNumber !== 0 ||
      entriesOnDisk !== expectedEntries ||
      (entriesOnDisk16 !== 0xffff && entriesOnDisk16 !== entriesOnDisk) ||
      (totalEntries16 !== 0xffff && totalEntries16 !== expectedEntries) ||
      (centralSize32 !== 0xffffffff && centralSize32 !== centralSize)
    ) {
      invalidArchive();
    }
  } else {
    if (entriesOnDisk16 !== totalEntries16) invalidArchive();
    expectedEntries = totalEntries16;
    centralSize = centralSize32;
    centralEnd = endOffset;
  }

  if (expectedEntries > MAX_ARCHIVE_ENTRIES) {
    throw new DocumentPreviewError("too_many_entries");
  }
  if (
    centralSize > centralEnd ||
    centralEnd > bytes.length ||
    (centralOffset32 !== 0xffffffff && centralOffset32 > bytes.length)
  ) {
    invalidArchive();
  }

  const centralStart = centralEnd - centralSize;
  let offset = centralStart;
  let entryCount = 0;
  let expandedSize = 0;

  while (offset < centralEnd) {
    assertRange(offset, 4, centralEnd);
    const signature = readUint32(bytes, offset);

    if (signature === ZIP_CENTRAL_FILE_HEADER_SIGNATURE) {
      assertRange(offset, 46, centralEnd);
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        throw new DocumentPreviewError("too_many_entries");
      }

      const filenameLength = readUint16(bytes, offset + 28);
      const extraLength = readUint16(bytes, offset + 30);
      const commentLength = readUint16(bytes, offset + 32);
      const recordLength = 46 + filenameLength + extraLength + commentLength;
      assertRange(offset, recordLength, centralEnd);

      const declaredSize = readUint32(bytes, offset + 24);
      const size = readZip64EntrySize(
        bytes,
        offset + 46 + filenameLength,
        extraLength,
        declaredSize,
      );
      expandedSize += size;
      if (
        !Number.isSafeInteger(expandedSize) ||
        expandedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES
      ) {
        throw new DocumentPreviewError("archive_too_large");
      }

      offset += recordLength;
      continue;
    }

    if (
      signature === ZIP_ARCHIVE_EXTRA_DATA_SIGNATURE ||
      signature === ZIP_CENTRAL_DIGITAL_SIGNATURE
    ) {
      const headerLength =
        signature === ZIP_ARCHIVE_EXTRA_DATA_SIGNATURE ? 8 : 6;
      assertRange(offset, headerLength, centralEnd);
      const payloadLength =
        signature === ZIP_ARCHIVE_EXTRA_DATA_SIGNATURE
          ? readUint32(bytes, offset + 4)
          : readUint16(bytes, offset + 4);
      const recordLength = headerLength + payloadLength;
      assertRange(offset, recordLength, centralEnd);
      offset += recordLength;
      continue;
    }

    invalidArchive();
  }

  if (entryCount !== expectedEntries) invalidArchive();
}

function entrySize(entry: JSZipObject): number {
  const size = (entry as ZipEntryWithSizes)._data?.uncompressedSize;
  if (entry.dir && size === undefined) return 0;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    invalidArchive();
  }
  return size;
}

function validateZip(zip: JSZip): JSZipObject[] {
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new DocumentPreviewError("too_many_entries");
  }

  let expandedSize = 0;
  for (const entry of entries) {
    expandedSize += entrySize(entry);
    if (expandedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new DocumentPreviewError("archive_too_large");
    }
  }
  return entries;
}

async function loadZip(bytes: Uint8Array): Promise<{
  zip: JSZip;
  entries: JSZipObject[];
}> {
  if (bytes.byteLength > MAX_CONTAINER_PREVIEW_BYTES) {
    throw new DocumentPreviewError("file_too_large");
  }

  try {
    preflightZip(bytes);
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
    return { zip, entries: validateZip(zip) };
  } catch (cause) {
    if (cause instanceof DocumentPreviewError) throw cause;
    throw new DocumentPreviewError("invalid_archive");
  }
}

function isTextEntry(path: string): boolean {
  return TEXT_ENTRY_EXTENSIONS.has(extensionOf(path));
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (entity, name: string) => {
      if (name === "amp") return "&";
      if (name === "lt") return "<";
      if (name === "gt") return ">";
      if (name === "quot") return '"';
      if (name === "apos") return "'";
      const radix = name.startsWith("#x") ? 16 : 10;
      const codePoint = Number.parseInt(
        name.slice(radix === 16 ? 2 : 1),
        radix,
      );
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        return "";
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    },
  );
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .slice(0, MAX_DOCUMENT_PREVIEW_CHARS);
}

function decodeUtf8(bytes: Uint8Array): string {
  const fragments: string[] = [];
  let codeUnits: number[] = [];

  const flushCodeUnits = () => {
    if (codeUnits.length) {
      fragments.push(String.fromCharCode(...codeUnits));
      codeUnits = [];
    }
  };
  const appendCodePoint = (codePoint: number) => {
    if (codePoint <= 0xffff) {
      codeUnits.push(codePoint);
    } else {
      const surrogate = codePoint - 0x10000;
      codeUnits.push(0xd800 + (surrogate >> 10), 0xdc00 + (surrogate & 0x3ff));
    }
    if (codeUnits.length >= 4096) flushCodeUnits();
  };
  const isContinuation = (index: number) =>
    index < bytes.length && bytes[index]! >= 0x80 && bytes[index]! <= 0xbf;

  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]!;
    if (first <= 0x7f) {
      appendCodePoint(first);
      index += 1;
      continue;
    }

    if (first >= 0xc2 && first <= 0xdf && isContinuation(index + 1)) {
      appendCodePoint(((first & 0x1f) << 6) | (bytes[index + 1]! & 0x3f));
      index += 2;
      continue;
    }

    const second = bytes[index + 1]!;
    const third = bytes[index + 2]!;
    const validThreeByteSequence =
      first >= 0xe0 &&
      first <= 0xef &&
      isContinuation(index + 1) &&
      isContinuation(index + 2) &&
      !(first === 0xe0 && second < 0xa0) &&
      !(first === 0xed && second > 0x9f);
    if (validThreeByteSequence) {
      appendCodePoint(
        ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f),
      );
      index += 3;
      continue;
    }

    const fourth = bytes[index + 3]!;
    const validFourByteSequence =
      first >= 0xf0 &&
      first <= 0xf4 &&
      isContinuation(index + 1) &&
      isContinuation(index + 2) &&
      isContinuation(index + 3) &&
      !(first === 0xf0 && second < 0x90) &&
      !(first === 0xf4 && second > 0x8f);
    if (validFourByteSequence) {
      appendCodePoint(
        ((first & 0x07) << 18) |
          ((second & 0x3f) << 12) |
          ((third & 0x3f) << 6) |
          (fourth & 0x3f),
      );
      index += 4;
      continue;
    }

    appendCodePoint(0xfffd);
    index += 1;
  }

  flushCodeUnits();
  return fragments.join("");
}

function readZipEntryBytes(
  entry: JSZipObject,
  maxFileBytes: number,
  sourceBytes?: { value: number },
  maxSourceBytes = Number.MAX_SAFE_INTEGER,
): Promise<Uint8Array> {
  const declaredSize = entrySize(entry);
  if (
    declaredSize > maxFileBytes ||
    (sourceBytes && sourceBytes.value + declaredSize > maxSourceBytes)
  ) {
    throw new DocumentPreviewError("archive_too_large");
  }

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let actualSize = 0;
    let settled = false;
    let stream: JSZip.JSZipStreamHelper<Uint8Array> | undefined;

    const fail = (cause: DocumentPreviewError) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      stream?.pause();
      reject(cause);
    };

    try {
      stream = (entry as StreamableZipEntry).internalStream("uint8array");
      stream
        .on("data", (chunk) => {
          if (settled) return;
          const nextSize = actualSize + chunk.byteLength;
          if (
            nextSize > maxFileBytes ||
            (sourceBytes && sourceBytes.value + nextSize > maxSourceBytes)
          ) {
            fail(new DocumentPreviewError("archive_too_large"));
            return;
          }
          actualSize = nextSize;
          chunks.push(chunk);
        })
        .on("error", () => fail(new DocumentPreviewError("invalid_archive")))
        .on("end", () => {
          if (settled) return;
          if (actualSize !== declaredSize) {
            fail(new DocumentPreviewError("invalid_archive"));
            return;
          }

          const output = new Uint8Array(actualSize);
          let offset = 0;
          for (const chunk of chunks) {
            output.set(chunk, offset);
            offset += chunk.byteLength;
          }
          if (sourceBytes) sourceBytes.value += actualSize;
          settled = true;
          resolve(output);
        });
      stream.resume();
    } catch {
      fail(new DocumentPreviewError("invalid_archive"));
    }
  });
}

function collectXmlText(xml: string, tag = "t"): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(
    `<(?:[\\w.-]+:)?${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escapedTag}\\s*>`,
    "g",
  );
  return [...xml.matchAll(matcher)]
    .map((match) => decodeXmlEntities(match[1] ?? ""))
    .join("");
}

async function readZipText(
  zip: JSZip,
  path: string,
  sourceBytes: { value: number },
  maxFileBytes = MAX_DOCUMENT_XML_FILE_BYTES,
): Promise<string> {
  const entry = zip.file(path);
  if (!entry || entry.dir) {
    throw new DocumentPreviewError("no_preview_content");
  }
  const bytes = await readZipEntryBytes(
    entry,
    maxFileBytes,
    sourceBytes,
    MAX_DOCUMENT_SOURCE_BYTES,
  );
  return decodeUtf8(bytes);
}

function collectOfficeParagraphText(paragraph: string): string {
  const tokens =
    /<(?:[\w.-]+:)?(t|tab|br|cr)\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>|<(?:[\w.-]+:)?(tab|br|cr)\b[^>]*\/>/g;
  let text = "";
  for (const token of paragraph.matchAll(tokens)) {
    const element = token[1] ?? token[3];
    if (element === "tab") {
      text += "\t";
    } else if (element === "br" || element === "cr") {
      text += "\n";
    } else {
      text += decodeXmlEntities(token[2] ?? "");
    }
  }
  return text;
}

function cleanOfficeParagraphs(xml: string): string {
  return cleanText(
    xml
      .split(/<w:p\b[^>]*>/)
      .map((paragraph) =>
        collectOfficeParagraphText(paragraph.split(/<\/w:p\s*>/)[0] ?? ""),
      )
      .filter(Boolean)
      .join("\n"),
  );
}

function parsePresentationText(xml: string): string {
  return cleanText(collectXmlText(xml, "t"));
}

function parseSpreadsheetText(xml: string, sharedStrings: string[]): string {
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row\s*>/g)];
  return cleanText(
    rows
      .map((row) => {
        const cells = [
          ...(row[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c\s*>/g),
        ];
        return cells
          .map((cell) => {
            const attributes = cell[1] ?? "";
            const value = cell[2] ?? "";
            const type = attributes.match(/\bt=["']([^"']+)["']/)?.[1];
            if (type === "inlineStr") return collectXmlText(value, "t");
            const raw = value.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1];
            if (!raw) return "";
            const decoded = decodeXmlEntities(raw);
            if (type === "s") {
              const index = Number.parseInt(decoded, 10);
              return Number.isInteger(index)
                ? (sharedStrings[index] ?? "")
                : "";
            }
            return decoded;
          })
          .join("\t");
      })
      .filter(Boolean)
      .join("\n"),
  );
}

async function readOfficePreview(
  zip: JSZip,
  filename: string,
): Promise<string> {
  const extension = extensionOf(filename);
  const sourceBytes = { value: 0 };

  if (extension === "docx") {
    const xml = await readZipText(zip, "word/document.xml", sourceBytes);
    const text = cleanOfficeParagraphs(xml);
    if (!text) throw new DocumentPreviewError("no_preview_content");
    return text;
  }

  if (extension === "pptx") {
    const slidePaths = Object.keys(zip.files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
      .sort(
        (left, right) =>
          Number(left.match(/slide(\d+)/i)?.[1] ?? 0) -
          Number(right.match(/slide(\d+)/i)?.[1] ?? 0),
      );
    if (!slidePaths.length)
      throw new DocumentPreviewError("no_preview_content");
    if (slidePaths.length > MAX_PRESENTATION_SLIDES) {
      throw new DocumentPreviewError("too_many_entries");
    }
    const slides: string[] = [];
    for (const path of slidePaths) {
      const xml = await readZipText(zip, path, sourceBytes);
      slides.push(parsePresentationText(xml));
    }
    const text = cleanText(
      slides.map((slide, index) => `Slide ${index + 1}\n${slide}`).join("\n\n"),
    );
    if (!text.trim()) throw new DocumentPreviewError("no_preview_content");
    return text;
  }

  if (extension === "xlsx") {
    const sharedStringFile = zip.file("xl/sharedStrings.xml");
    const sharedStrings: string[] = [];
    if (sharedStringFile) {
      const xml = await readZipText(zip, "xl/sharedStrings.xml", sourceBytes);
      for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si\s*>/g)) {
        sharedStrings.push(collectXmlText(item[1] ?? "", "t"));
      }
    }

    const sheetPaths = Object.keys(zip.files)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort(
        (left, right) =>
          Number(left.match(/sheet(\d+)/i)?.[1] ?? 0) -
          Number(right.match(/sheet(\d+)/i)?.[1] ?? 0),
      );
    if (!sheetPaths.length)
      throw new DocumentPreviewError("no_preview_content");
    const sheets: string[] = [];
    for (const path of sheetPaths.slice(0, 20)) {
      const xml = await readZipText(zip, path, sourceBytes);
      sheets.push(parseSpreadsheetText(xml, sharedStrings));
    }
    const text = cleanText(sheets.filter(Boolean).join("\n\n"));
    if (!text.trim()) throw new DocumentPreviewError("no_preview_content");
    return text;
  }

  throw new DocumentPreviewError("unsupported_document");
}

function readAttribute(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    attributes.match(new RegExp(`(?:^|\\s)${escaped}=["']([^"']*)["']`))?.[1] ??
    null
  );
}

function resolveZipPath(baseFile: string, relativePath: string): string {
  const segments = relativePath.startsWith("/")
    ? []
    : baseFile.split("/").slice(0, -1);
  for (const part of relativePath.replace(/^\//, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

function stripMarkupToText(markup: string): string {
  return cleanText(
    decodeXmlEntities(
      markup
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<\/(?:p|div|h[1-6]|li|section|article|br|tr)\s*>/gi, "\n")
        .replace(/<[^>]*>/g, " "),
    ),
  )
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readEpubPreview(zip: JSZip): Promise<{
  title: string;
  chapters: EpubPreviewChapter[];
}> {
  const sourceBytes = { value: 0 };
  const container = await readZipText(
    zip,
    "META-INF/container.xml",
    sourceBytes,
  );
  const packagePath = container.match(
    /<rootfile\b[^>]*\bfull-path=["']([^"']+)["']/i,
  )?.[1];
  if (!packagePath) throw new DocumentPreviewError("invalid_archive");

  const opf = await readZipText(zip, packagePath, sourceBytes);
  const titleMarkup = opf.match(
    /<(?:[\w.-]+:)?title\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?title\s*>/i,
  )?.[1];
  const title = titleMarkup ? stripMarkupToText(titleMarkup) : "ePub preview";
  const manifest = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b([^>]*?)\/?\s*>/gi)) {
    const attributes = item[1] ?? "";
    const id = readAttribute(attributes, "id");
    const href = readAttribute(attributes, "href");
    const mediaType = readAttribute(attributes, "media-type") ?? "";
    if (id && href && /application\/xhtml\+xml|text\/html/i.test(mediaType)) {
      manifest.set(id, resolveZipPath(packagePath, href));
    }
  }

  const spineIds = [...opf.matchAll(/<itemref\b([^>]*?)\/?\s*>/gi)]
    .map((item) => readAttribute(item[1] ?? "", "idref"))
    .filter((id): id is string => id !== null);
  if (!spineIds.length) throw new DocumentPreviewError("no_preview_content");
  if (spineIds.length > MAX_EPUB_CHAPTERS) {
    throw new DocumentPreviewError("too_many_entries");
  }

  const chapters: EpubPreviewChapter[] = [];
  for (const [index, id] of spineIds.entries()) {
    const path = manifest.get(id);
    if (!path) continue;
    const markup = await readZipText(zip, path, sourceBytes);
    const text = stripMarkupToText(markup);
    if (text) chapters.push({ id, label: `Chapter ${index + 1}`, text });
  }
  if (!chapters.length) throw new DocumentPreviewError("no_preview_content");
  return { title, chapters };
}

export async function loadDocumentPreview(
  bytes: Uint8Array,
  kind: DocumentPreviewKind,
  filename: string,
): Promise<DocumentPreview> {
  const { zip, entries } = await loadZip(bytes);

  if (kind === "archive") {
    const archiveEntries = entries
      .map((entry) => ({
        path: entry.name,
        size: entrySize(entry),
        isFolder: entry.dir,
        canPreviewText:
          !entry.dir &&
          isTextEntry(entry.name) &&
          entrySize(entry) <= MAX_ARCHIVE_TEXT_ENTRY_BYTES,
      }))
      .sort((left, right) => left.path.localeCompare(right.path, "en"));
    return {
      type: "archive",
      entries: archiveEntries,
      readTextEntry: async (path) => {
        const metadata = archiveEntries.find((entry) => entry.path === path);
        const file = zip.file(path);
        if (!metadata?.canPreviewText || !file) {
          throw new DocumentPreviewError("unsupported_document");
        }
        const bytes = await readZipEntryBytes(
          file,
          MAX_ARCHIVE_TEXT_ENTRY_BYTES,
        );
        return cleanText(decodeUtf8(bytes));
      },
    };
  }

  if (kind === "office") {
    return { type: "text", text: await readOfficePreview(zip, filename) };
  }

  const epub = await readEpubPreview(zip);
  return { type: "epub", ...epub };
}
