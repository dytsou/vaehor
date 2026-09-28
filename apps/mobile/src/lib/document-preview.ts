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

type ZipDirectoryInfo = {
  expectedEntries: number;
  centralSize: number;
  centralEnd: number;
  centralOffset32: number;
};

function readZipDirectoryInfo(
  bytes: Uint8Array,
  endOffset: number,
): ZipDirectoryInfo {
  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDiskNumber = readUint16(bytes, endOffset + 6);
  const entriesOnDisk16 = readUint16(bytes, endOffset + 8);
  const totalEntries16 = readUint16(bytes, endOffset + 10);
  const centralSize32 = readUint32(bytes, endOffset + 12);
  const centralOffset32 = readUint32(bytes, endOffset + 16);
  if (diskNumber !== 0 || centralDiskNumber !== 0) invalidArchive();

  const zip64Required =
    entriesOnDisk16 === 0xffff ||
    totalEntries16 === 0xffff ||
    centralSize32 === 0xffffffff ||
    centralOffset32 === 0xffffffff;
  if (!zip64Required) {
    if (entriesOnDisk16 !== totalEntries16) invalidArchive();
    return {
      expectedEntries: totalEntries16,
      centralSize: centralSize32,
      centralEnd: endOffset,
      centralOffset32,
    };
  }

  const locatorOffset = endOffset - 20;
  assertRange(locatorOffset, 20, bytes.length);
  assertZip64Locator(bytes, locatorOffset);
  const zip64Offset = readUint64(bytes, locatorOffset + 8);
  assertRange(zip64Offset, 56, locatorOffset);
  assertZip64EndRecord(bytes, zip64Offset, locatorOffset);

  const zip64DiskNumber = readUint32(bytes, zip64Offset + 16);
  const zip64CentralDiskNumber = readUint32(bytes, zip64Offset + 20);
  const entriesOnDisk = readUint64(bytes, zip64Offset + 24);
  const expectedEntries = readUint64(bytes, zip64Offset + 32);
  const centralSize = readUint64(bytes, zip64Offset + 40);
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
  return {
    expectedEntries,
    centralSize,
    centralEnd: zip64Offset,
    centralOffset32,
  };
}

function assertZip64Locator(bytes: Uint8Array, offset: number): void {
  if (
    readUint32(bytes, offset) !==
      ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE ||
    readUint32(bytes, offset + 4) !== 0 ||
    readUint32(bytes, offset + 16) !== 1
  ) {
    invalidArchive();
  }
}

function assertZip64EndRecord(
  bytes: Uint8Array,
  offset: number,
  locatorOffset: number,
): void {
  if (readUint32(bytes, offset) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    invalidArchive();
  }
  const recordSize = readUint64(bytes, offset + 4);
  if (recordSize < 44 || offset + 12 + recordSize !== locatorOffset) {
    invalidArchive();
  }
}

function readCentralRecord(
  bytes: Uint8Array,
  offset: number,
  centralEnd: number,
): { recordLength: number; expandedSize: number; isFileHeader: boolean } {
  assertRange(offset, 4, centralEnd);
  const signature = readUint32(bytes, offset);
  if (signature === ZIP_CENTRAL_FILE_HEADER_SIGNATURE) {
    assertRange(offset, 46, centralEnd);
    const filenameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const recordLength = 46 + filenameLength + extraLength + commentLength;
    assertRange(offset, recordLength, centralEnd);
    const size = readZip64EntrySize(
      bytes,
      offset + 46 + filenameLength,
      extraLength,
      readUint32(bytes, offset + 24),
    );
    return { recordLength, expandedSize: size, isFileHeader: true };
  }

  if (
    signature === ZIP_ARCHIVE_EXTRA_DATA_SIGNATURE ||
    signature === ZIP_CENTRAL_DIGITAL_SIGNATURE
  ) {
    const headerLength = signature === ZIP_ARCHIVE_EXTRA_DATA_SIGNATURE ? 8 : 6;
    assertRange(offset, headerLength, centralEnd);
    const payloadLength =
      headerLength === 8
        ? readUint32(bytes, offset + 4)
        : readUint16(bytes, offset + 4);
    const recordLength = headerLength + payloadLength;
    assertRange(offset, recordLength, centralEnd);
    return { recordLength, expandedSize: 0, isFileHeader: false };
  }
  invalidArchive();
}

function countCentralDirectoryEntries(
  bytes: Uint8Array,
  centralStart: number,
  centralEnd: number,
): number {
  let offset = centralStart;
  let entryCount = 0;
  let expandedSize = 0;
  while (offset < centralEnd) {
    const record = readCentralRecord(bytes, offset, centralEnd);
    expandedSize += record.expandedSize;
    if (
      !Number.isSafeInteger(expandedSize) ||
      expandedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES
    ) {
      throw new DocumentPreviewError("archive_too_large");
    }
    if (record.isFileHeader) {
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        throw new DocumentPreviewError("too_many_entries");
      }
    }
    offset += record.recordLength;
  }
  return entryCount;
}

function preflightZip(bytes: Uint8Array): void {
  const endOffset = findEndOfCentralDirectory(bytes);
  const directory = readZipDirectoryInfo(bytes, endOffset);
  if (directory.expectedEntries > MAX_ARCHIVE_ENTRIES) {
    throw new DocumentPreviewError("too_many_entries");
  }
  if (
    directory.centralSize > directory.centralEnd ||
    directory.centralEnd > bytes.length ||
    (directory.centralOffset32 !== 0xffffffff &&
      directory.centralOffset32 > bytes.length)
  ) {
    invalidArchive();
  }
  const centralStart = directory.centralEnd - directory.centralSize;
  if (
    countCentralDirectoryEntries(bytes, centralStart, directory.centralEnd) !==
    directory.expectedEntries
  ) {
    invalidArchive();
  }
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

function isUtf8Continuation(bytes: Uint8Array, index: number): boolean {
  return index < bytes.length && bytes[index]! >= 0x80 && bytes[index]! <= 0xbf;
}

function decodeUtf8Sequence(
  bytes: Uint8Array,
  index: number,
): { codePoint: number; byteLength: number } {
  const first = bytes[index]!;
  const second = bytes[index + 1]!;
  const third = bytes[index + 2]!;
  const fourth = bytes[index + 3]!;
  if (first <= 0x7f) return { codePoint: first, byteLength: 1 };
  if (first >= 0xc2 && first <= 0xdf && isUtf8Continuation(bytes, index + 1)) {
    return {
      codePoint: ((first & 0x1f) << 6) | (second & 0x3f),
      byteLength: 2,
    };
  }
  if (
    first >= 0xe0 &&
    first <= 0xef &&
    isUtf8Continuation(bytes, index + 1) &&
    isUtf8Continuation(bytes, index + 2) &&
    !(first === 0xe0 && second < 0xa0) &&
    !(first === 0xed && second > 0x9f)
  ) {
    return {
      codePoint:
        ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f),
      byteLength: 3,
    };
  }
  if (
    first >= 0xf0 &&
    first <= 0xf4 &&
    isUtf8Continuation(bytes, index + 1) &&
    isUtf8Continuation(bytes, index + 2) &&
    isUtf8Continuation(bytes, index + 3) &&
    !(first === 0xf0 && second < 0x90) &&
    !(first === 0xf4 && second > 0x8f)
  ) {
    return {
      codePoint:
        ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f),
      byteLength: 4,
    };
  }
  return { codePoint: 0xfffd, byteLength: 1 };
}

function flushUtf8CodePoints(codePoints: number[], fragments: string[]): void {
  if (codePoints.length === 0) return;
  fragments.push(String.fromCodePoint(...codePoints));
  codePoints.length = 0;
}

function decodeUtf8(bytes: Uint8Array): string {
  const fragments: string[] = [];
  const codePoints: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const sequence = decodeUtf8Sequence(bytes, index);
    codePoints.push(sequence.codePoint);
    if (codePoints.length >= 2048) flushUtf8CodePoints(codePoints, fragments);
    index += sequence.byteLength;
  }
  flushUtf8CodePoints(codePoints, fragments);
  return fragments.join("");
}

type ZipEntryReadState = {
  declaredSize: number;
  maxFileBytes: number;
  maxSourceBytes: number;
  sourceBytes?: { value: number };
  chunks: Uint8Array[];
  actualSize: number;
  settled: boolean;
  stream?: JSZip.JSZipStreamHelper<Uint8Array>;
  resolve: (value: Uint8Array) => void;
  reject: (cause: DocumentPreviewError) => void;
};

function failZipEntryRead(
  state: ZipEntryReadState,
  cause: DocumentPreviewError,
): void {
  if (state.settled) return;
  state.settled = true;
  state.chunks.length = 0;
  state.stream?.pause();
  state.reject(cause);
}

function collectZipEntryChunk(
  state: ZipEntryReadState,
  chunk: Uint8Array,
): void {
  if (state.settled) return;
  const nextSize = state.actualSize + chunk.byteLength;
  if (
    nextSize > state.maxFileBytes ||
    (state.sourceBytes &&
      state.sourceBytes.value + nextSize > state.maxSourceBytes)
  ) {
    failZipEntryRead(state, new DocumentPreviewError("archive_too_large"));
    return;
  }
  state.actualSize = nextSize;
  state.chunks.push(chunk);
}

function finishZipEntryRead(state: ZipEntryReadState): void {
  if (state.settled) return;
  if (state.actualSize !== state.declaredSize) {
    failZipEntryRead(state, new DocumentPreviewError("invalid_archive"));
    return;
  }

  const output = new Uint8Array(state.actualSize);
  let offset = 0;
  for (const chunk of state.chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (state.sourceBytes) state.sourceBytes.value += state.actualSize;
  state.settled = true;
  state.resolve(output);
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
    const state: ZipEntryReadState = {
      declaredSize,
      maxFileBytes,
      maxSourceBytes,
      sourceBytes,
      chunks: [],
      actualSize: 0,
      settled: false,
      resolve,
      reject,
    };

    try {
      state.stream = (entry as StreamableZipEntry).internalStream("uint8array");
      state.stream
        .on("data", (chunk) => collectZipEntryChunk(state, chunk))
        .on("error", () =>
          failZipEntryRead(state, new DocumentPreviewError("invalid_archive")),
        )
        .on("end", () => finishZipEntryRead(state));
      state.stream.resume();
    } catch {
      failZipEntryRead(state, new DocumentPreviewError("invalid_archive"));
    }
  });
}

type XmlMarkupResult = Readonly<{
  cursor: number;
  collecting: boolean;
  text: string;
}>;

function isXmlNameBoundary(character: string): boolean {
  return character === "/" || character === ">" || /\s/.test(character);
}

function localXmlName(xml: string, start: number, end: number): string {
  let nameEnd = start;
  while (nameEnd < end && !isXmlNameBoundary(xml[nameEnd]!)) nameEnd += 1;
  const qualifiedName = xml.slice(start, nameEnd);
  const namespaceSeparator = qualifiedName.lastIndexOf(":");
  return namespaceSeparator < 0
    ? qualifiedName
    : qualifiedName.slice(namespaceSeparator + 1);
}

function readXmlTextMarkup(
  xml: string,
  cursor: number,
  tag: string,
  collecting: boolean,
): XmlMarkupResult | null {
  if (xml.startsWith("<![CDATA[", cursor)) {
    const cdataEnd = xml.indexOf("]]>", cursor + 9);
    if (cdataEnd < 0) return null;
    return {
      cursor: cdataEnd + 3,
      collecting,
      text: collecting ? xml.slice(cursor + 9, cdataEnd) : "",
    };
  }

  const tagEnd = xml.indexOf(">", cursor + 1);
  if (tagEnd < 0) return null;
  const closing = xml[cursor + 1] === "/";
  const nameStart = cursor + (closing ? 2 : 1);
  const matchesTag = localXmlName(xml, nameStart, tagEnd) === tag;
  const nextCollecting = matchesTag
    ? !closing && xml[tagEnd - 1] !== "/"
    : collecting;
  return { cursor: tagEnd + 1, collecting: nextCollecting, text: "" };
}

function collectXmlText(xml: string, tag = "t"): string {
  const parts: string[] = [];
  let cursor = 0;
  let contentStart = 0;
  let collecting = false;

  while (cursor < xml.length) {
    const markupStart = xml.indexOf("<", cursor);
    if (markupStart < 0) {
      if (collecting) parts.push(xml.slice(contentStart));
      break;
    }
    if (collecting && markupStart > contentStart) {
      parts.push(xml.slice(contentStart, markupStart));
    }

    const markup = readXmlTextMarkup(xml, markupStart, tag, collecting);
    if (!markup) break;
    if (markup.text) parts.push(markup.text);
    cursor = markup.cursor;
    contentStart = cursor;
    collecting = markup.collecting;
  }
  return decodeXmlEntities(parts.join(""));
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
  const separators = /<(?:[\w.-]+:)?(tab|br|cr)\b[^>]*>/g;
  let text = "";
  let cursor = 0;

  for (const separator of paragraph.matchAll(separators)) {
    const separatorIndex = separator.index ?? cursor;
    text += collectXmlText(paragraph.slice(cursor, separatorIndex));
    text += separator[1] === "tab" ? "\t" : "\n";
    cursor = separatorIndex + separator[0].length;
  }

  return text + collectXmlText(paragraph.slice(cursor));
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
            const type = /\bt=["']([^"']+)["']/.exec(attributes)?.[1];
            if (type === "inlineStr") return collectXmlText(value, "t");
            const raw = /<v\b[^>]*>([\s\S]*?)<\/v\s*>/.exec(value)?.[1];
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

function officeNumberedPathIndex(path: string, prefix: string): number {
  const lowerPath = path.toLowerCase();
  const prefixIndex = lowerPath.lastIndexOf(prefix);
  if (prefixIndex < 0) return 0;

  let end = prefixIndex + prefix.length;
  while (end < path.length) {
    const character = path.codePointAt(end) ?? 0;
    if (character < 48 || character > 57) break;
    end += 1;
  }
  return Number(path.slice(prefixIndex + prefix.length, end)) || 0;
}

function requireOfficePreviewText(text: string): string {
  if (!text.trim()) throw new DocumentPreviewError("no_preview_content");
  return text;
}

async function readWordPreview(
  zip: JSZip,
  sourceBytes: { value: number },
): Promise<string> {
  const xml = await readZipText(zip, "word/document.xml", sourceBytes);
  return requireOfficePreviewText(cleanOfficeParagraphs(xml));
}

async function readPresentationPreview(
  zip: JSZip,
  sourceBytes: { value: number },
): Promise<string> {
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort(
      (left, right) =>
        officeNumberedPathIndex(left, "slide") -
        officeNumberedPathIndex(right, "slide"),
    );
  if (!slidePaths.length) throw new DocumentPreviewError("no_preview_content");
  if (slidePaths.length > MAX_PRESENTATION_SLIDES) {
    throw new DocumentPreviewError("too_many_entries");
  }

  const slides: string[] = [];
  for (const path of slidePaths) {
    const xml = await readZipText(zip, path, sourceBytes);
    slides.push(parsePresentationText(xml));
  }
  const text = cleanText(
    slides
      .map((slide, index) => "Slide " + (index + 1) + "\n" + slide)
      .join("\n\n"),
  );
  return requireOfficePreviewText(text);
}

async function readSpreadsheetPreview(
  zip: JSZip,
  sourceBytes: { value: number },
): Promise<string> {
  const sharedStrings: string[] = [];
  if (zip.file("xl/sharedStrings.xml")) {
    const xml = await readZipText(zip, "xl/sharedStrings.xml", sourceBytes);
    for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si\s*>/g)) {
      sharedStrings.push(collectXmlText(item[1] ?? "", "t"));
    }
  }

  const sheetPaths = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort(
      (left, right) =>
        officeNumberedPathIndex(left, "sheet") -
        officeNumberedPathIndex(right, "sheet"),
    );
  if (!sheetPaths.length) throw new DocumentPreviewError("no_preview_content");

  const sheets: string[] = [];
  for (const path of sheetPaths.slice(0, 20)) {
    const xml = await readZipText(zip, path, sourceBytes);
    sheets.push(parseSpreadsheetText(xml, sharedStrings));
  }
  return requireOfficePreviewText(
    cleanText(sheets.filter(Boolean).join("\n\n")),
  );
}

async function readOfficePreview(
  zip: JSZip,
  filename: string,
): Promise<string> {
  const sourceBytes = { value: 0 };
  switch (extensionOf(filename)) {
    case "docx":
      return readWordPreview(zip, sourceBytes);
    case "pptx":
      return readPresentationPreview(zip, sourceBytes);
    case "xlsx":
      return readSpreadsheetPreview(zip, sourceBytes);
    default:
      throw new DocumentPreviewError("unsupported_document");
  }
}

function skipAttributeWhitespace(attributes: string, cursor: number): number {
  while (/\s/.test(attributes[cursor] ?? "")) cursor += 1;
  return cursor;
}

function readAttributes(attributes: string): { name: string; value: string }[] {
  const result: { name: string; value: string }[] = [];
  let cursor = 0;
  while (cursor < attributes.length) {
    cursor = skipAttributeWhitespace(attributes, cursor);
    const nameStart = cursor;
    while (cursor < attributes.length && !/[\s=/>]/.test(attributes[cursor]!)) {
      cursor += 1;
    }
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const attributeName = attributes.slice(nameStart, cursor);
    cursor = skipAttributeWhitespace(attributes, cursor);
    if (attributes[cursor] !== "=") continue;
    cursor = skipAttributeWhitespace(attributes, cursor + 1);
    const quote = attributes[cursor];
    if (quote !== "'" && quote !== '"') {
      cursor += 1;
      continue;
    }
    const valueStart = cursor + 1;
    const valueEnd = attributes.indexOf(quote, valueStart);
    if (valueEnd === -1) break;
    result.push({
      name: attributeName,
      value: attributes.slice(valueStart, valueEnd),
    });
    cursor = valueEnd + 1;
  }
  return result;
}

function readAttribute(attributes: string, name: string): string | null {
  return (
    readAttributes(attributes).find((attribute) => attribute.name === name)
      ?.value ?? null
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

const BLOCK_MARKUP_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "section",
  "article",
  "br",
  "tr",
]);

function normalizeMarkupWhitespace(value: string): string {
  let result = "";
  let pendingSpace = false;
  let consecutiveNewlines = 0;

  for (const character of value) {
    if (character === " " || character === "\t") {
      pendingSpace = true;
      continue;
    }
    if (character === "\n") {
      pendingSpace = false;
      if (consecutiveNewlines < 2) result += "\n";
      consecutiveNewlines += 1;
      continue;
    }

    if (pendingSpace && result.length > 0 && !result.endsWith("\n")) {
      result += " ";
    }
    pendingSpace = false;
    consecutiveNewlines = 0;
    result += character;
  }

  return result.trim();
}

type MarkupTextResult = Readonly<{
  cursor: number;
  ignoredTag: "script" | "style" | null;
  text: string;
  done?: boolean;
}>;

function readMarkupTextTag(
  markup: string,
  tagStart: number,
  ignoredTag: "script" | "style" | null,
): MarkupTextResult {
  if (markup.startsWith("<!--", tagStart)) {
    const commentEnd = markup.indexOf("-->", tagStart + 4);
    return commentEnd < 0
      ? { cursor: markup.length, ignoredTag, text: "", done: true }
      : { cursor: commentEnd + 3, ignoredTag, text: "" };
  }
  const tagEnd = markup.indexOf(">", tagStart + 1);
  if (tagEnd < 0) {
    return {
      cursor: markup.length,
      ignoredTag,
      text: ignoredTag ? "" : markup.slice(tagStart),
      done: true,
    };
  }

  const rawTag = markup.slice(tagStart + 1, tagEnd).trim();
  const closing = rawTag.startsWith("/");
  const tagBody = closing ? rawTag.slice(1).trim() : rawTag;
  const tagName = (tagBody.split(/[\s/]/, 1)[0] ?? "").toLowerCase();
  const selfClosing = tagBody.endsWith("/");
  const cursor = tagEnd + 1;

  if (ignoredTag) {
    return {
      cursor,
      ignoredTag: closing && tagName === ignoredTag ? null : ignoredTag,
      text: "",
    };
  }
  if (
    !closing &&
    !selfClosing &&
    (tagName === "script" || tagName === "style")
  ) {
    return { cursor, ignoredTag: tagName, text: "" };
  }
  return {
    cursor,
    ignoredTag: null,
    text: closing && BLOCK_MARKUP_TAGS.has(tagName) ? "\n" : " ",
  };
}

function stripMarkupToText(markup: string): string {
  let text = "";
  let cursor = 0;
  let ignoredTag: "script" | "style" | null = null;

  while (cursor < markup.length) {
    const tagStart = markup.indexOf("<", cursor);
    if (tagStart < 0) {
      if (!ignoredTag) text += markup.slice(cursor);
      break;
    }
    if (!ignoredTag && tagStart > cursor)
      text += markup.slice(cursor, tagStart);
    const result = readMarkupTextTag(markup, tagStart, ignoredTag);
    text += result.text;
    cursor = result.cursor;
    ignoredTag = result.ignoredTag;
    if (result.done) break;
  }

  return normalizeMarkupWhitespace(cleanText(decodeXmlEntities(text)));
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
  const rootfileTag = /<rootfile\b[^>]*>/i.exec(container)?.[0] ?? "";
  const packagePath = readAttribute(rootfileTag, "full-path");
  if (!packagePath) throw new DocumentPreviewError("invalid_archive");

  const opf = await readZipText(zip, packagePath, sourceBytes);
  const titleMatch =
    /<(?:[\w.-]+:)?title\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?title\s*>/i.exec(opf);
  const title = titleMatch?.[1]
    ? stripMarkupToText(titleMatch[1])
    : "ePub preview";
  const manifest = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b([^>]*)>/gi)) {
    const attributes = item[1] ?? "";
    const id = readAttribute(attributes, "id");
    const href = readAttribute(attributes, "href");
    const mediaType = readAttribute(attributes, "media-type") ?? "";
    if (id && href && /application\/xhtml\+xml|text\/html/i.test(mediaType)) {
      manifest.set(id, resolveZipPath(packagePath, href));
    }
  }

  const spineIds = [...opf.matchAll(/<itemref\b([^>]*)>/gi)]
    .map((item) => readAttribute(item[1] ?? "", "idref"))
    .filter((id): id is string => id !== null);
  if (!spineIds.length) throw new DocumentPreviewError("no_preview_content");
  if (spineIds.length > MAX_EPUB_CHAPTERS) {
    throw new DocumentPreviewError("too_many_entries");
  }

  const chapters: EpubPreviewChapter[] = [];
  for (const [index, id] of spineIds.entries()) {
    const chapterPath = manifest.get(id);
    if (!chapterPath) continue;
    const markup = await readZipText(zip, chapterPath, sourceBytes);
    const text = stripMarkupToText(markup);
    if (text) chapters.push({ id, label: "Chapter " + (index + 1), text });
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
