import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  DocumentPreviewError,
  loadDocumentPreview,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_CONTAINER_PREVIEW_BYTES,
} from "../src/lib/document-preview";

async function zipBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array" });
}

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  throw new Error("ZIP signature was not found");
}

function replaceDeclaredEntrySizes(
  bytes: Uint8Array,
  size: number,
  replaceLocalHeader = true,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralOffset = findSignature(bytes, 0x02014b50);
  view.setUint32(centralOffset + 24, size, true);
  if (replaceLocalHeader) {
    const localOffset = findSignature(bytes, 0x04034b50);
    view.setUint32(localOffset + 22, size, true);
  }
  return bytes;
}

function addZip64EndRecords(bytes: Uint8Array): Uint8Array {
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findSignature(bytes, 0x06054b50);
  const entries = input.getUint16(endOffset + 10, true);
  const centralSize = input.getUint32(endOffset + 12, true);
  const centralOffset = input.getUint32(endOffset + 16, true);
  const output = new Uint8Array(bytes.byteLength + 76);
  output.set(bytes.subarray(0, endOffset));

  const zip64Offset = endOffset;
  const locatorOffset = zip64Offset + 56;
  const newEndOffset = locatorOffset + 20;
  const view = new DataView(output.buffer);
  view.setUint32(zip64Offset, 0x06064b50, true);
  view.setUint32(zip64Offset + 4, 44, true);
  view.setUint16(zip64Offset + 12, 45, true);
  view.setUint16(zip64Offset + 14, 45, true);
  view.setUint32(zip64Offset + 16, 0, true);
  view.setUint32(zip64Offset + 20, 0, true);
  view.setUint32(zip64Offset + 24, entries, true);
  view.setUint32(zip64Offset + 28, 0, true);
  view.setUint32(zip64Offset + 32, entries, true);
  view.setUint32(zip64Offset + 36, 0, true);
  view.setUint32(zip64Offset + 40, centralSize, true);
  view.setUint32(zip64Offset + 44, 0, true);
  view.setUint32(zip64Offset + 48, centralOffset, true);
  view.setUint32(zip64Offset + 52, 0, true);

  view.setUint32(locatorOffset, 0x07064b50, true);
  view.setUint32(locatorOffset + 4, 0, true);
  view.setUint32(locatorOffset + 8, zip64Offset, true);
  view.setUint32(locatorOffset + 12, 0, true);
  view.setUint32(locatorOffset + 16, 1, true);
  output.set(bytes.subarray(endOffset), newEndOffset);

  view.setUint16(newEndOffset + 8, 0xffff, true);
  view.setUint16(newEndOffset + 10, 0xffff, true);
  view.setUint32(newEndOffset + 12, 0xffffffff, true);
  view.setUint32(newEndOffset + 16, 0xffffffff, true);
  return output;
}

describe("bounded native document previews", () => {
  it("lists archive entries and previews only supported small text entries", async () => {
    const bytes = await zipBytes({
      "docs/readme.txt": "hello & goodbye",
      "images/photo.png": "not an image",
    });

    const preview = await loadDocumentPreview(bytes, "archive", "backup.zip");
    expect(preview.type).toBe("archive");
    if (preview.type !== "archive") return;

    expect(preview.entries).toContainEqual({
      path: "docs/readme.txt",
      size: 15,
      isFolder: false,
      canPreviewText: true,
    });
    expect(await preview.readTextEntry("docs/readme.txt")).toBe(
      "hello & goodbye",
    );
    await expect(
      preview.readTextEntry("images/photo.png"),
    ).rejects.toMatchObject({
      code: "unsupported_document",
    });
  });

  it("extracts text from DOCX paragraphs and decodes entities once", async () => {
    const bytes = await zipBytes({
      "word/document.xml":
        '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>First &amp;lt; line</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>',
    });

    const preview = await loadDocumentPreview(bytes, "office", "notes.docx");
    expect(preview).toEqual({ type: "text", text: "First &lt; line\nSecond" });
  });

  it("preserves DOCX tabs and manual line breaks", async () => {
    const bytes = await zipBytes({
      "word/document.xml":
        "<w:document><w:body><w:p><w:r><w:t>First</w:t><w:tab/><w:t>Second</w:t><w:br/><w:t>Third</w:t></w:r></w:p></w:body></w:document>",
    });

    const preview = await loadDocumentPreview(bytes, "office", "notes.docx");
    expect(preview).toEqual({
      type: "text",
      text: "First\tSecond\nThird",
    });
  });

  it("extracts slides from PPTX in numeric slide order", async () => {
    const bytes = await zipBytes({
      "ppt/slides/slide10.xml": "<p:sld><a:t>Ten</a:t></p:sld>",
      "ppt/slides/slide2.xml": "<p:sld><a:t>Two</a:t></p:sld>",
    });

    const preview = await loadDocumentPreview(bytes, "office", "deck.pptx");
    expect(preview).toEqual({
      type: "text",
      text: "Slide 1\nTwo\n\nSlide 2\nTen",
    });
  });

  it("extracts shared and inline strings from XLSX rows", async () => {
    const bytes = await zipBytes({
      "xl/sharedStrings.xml":
        '<sst xmlns="urn:x"><si><t>Quarter</t></si><si><t>Revenue &amp; cost</t></si></sst>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>2026</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>',
    });

    const preview = await loadDocumentPreview(bytes, "office", "report.xlsx");
    expect(preview).toEqual({
      type: "text",
      text: "Quarter\t2026\nRevenue & cost\t42",
    });
  });

  it("reads large XLSX shared-string tables without spreading into function arguments", async () => {
    const sharedStringCount = 130_000;
    const sharedStrings =
      "<sst>" + "<si><t>x</t></si>".repeat(sharedStringCount) + "</sst>";
    const bytes = await zipBytes({
      "xl/sharedStrings.xml": sharedStrings,
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row><c t="s"><v>129999</v></c></row></sheetData></worksheet>',
    });

    const preview = await loadDocumentPreview(bytes, "office", "large.xlsx");
    expect(preview).toEqual({ type: "text", text: "x" });
  }, 15_000);

  it("uses ePub spine order for chapter navigation", async () => {
    const bytes = await zipBytes({
      "META-INF/container.xml":
        '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
      "OPS/book.opf":
        '<package xmlns:dc="urn:dc"><metadata><dc:title>Sample Book</dc:title></metadata><manifest><item id="second" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/><item id="first" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>',
      "OPS/text/chapter1.xhtml":
        "<html><body><h1>Opening</h1><p>Hello &amp; welcome.</p></body></html>",
      "OPS/text/chapter2.xhtml":
        "<html><body><p>Next chapter.</p></body></html>",
    });

    const preview = await loadDocumentPreview(bytes, "epub", "sample.epub");
    expect(preview).toEqual({
      type: "epub",
      title: "Sample Book",
      chapters: [
        { id: "first", label: "Chapter 1", text: "Opening\nHello & welcome." },
        { id: "second", label: "Chapter 2", text: "Next chapter." },
      ],
    });
  });

  it("rejects oversized, malformed and excessive-entry archives safely", async () => {
    await expect(
      loadDocumentPreview(
        new Uint8Array(MAX_CONTAINER_PREVIEW_BYTES + 1),
        "archive",
        "large.zip",
      ),
    ).rejects.toMatchObject({ code: "file_too_large" });
    await expect(
      loadDocumentPreview(new Uint8Array([1, 2, 3]), "archive", "bad.zip"),
    ).rejects.toBeInstanceOf(DocumentPreviewError);

    const manyFiles = new JSZip();
    for (let index = 0; index <= MAX_ARCHIVE_ENTRIES; index += 1) {
      manyFiles.file(`item-${index}.txt`, "");
    }
    const bytes = await manyFiles.generateAsync({ type: "uint8array" });
    await expect(
      loadDocumentPreview(bytes, "archive", "many.zip"),
    ).rejects.toMatchObject({ code: "too_many_entries" });
  });

  it("rejects central-directory expansion claims before reading file contents", async () => {
    const bytes = await zipBytes({ "payload.txt": "small" });
    replaceDeclaredEntrySizes(bytes, MAX_ARCHIVE_UNCOMPRESSED_BYTES + 1, false);

    await expect(
      loadDocumentPreview(bytes, "archive", "oversized.zip"),
    ).rejects.toMatchObject({ code: "archive_too_large" });
  });

  it("accepts valid ZIP64 end records", async () => {
    const bytes = addZip64EndRecords(
      await zipBytes({ "sample.txt": "ZIP64 preview" }),
    );

    const preview = await loadDocumentPreview(bytes, "archive", "zip64.zip");
    expect(preview.type).toBe("archive");
    if (preview.type !== "archive") return;
    expect(await preview.readTextEntry("sample.txt")).toBe("ZIP64 preview");
  });

  it("stops streamed archive reads at the actual output limit when sizes lie", async () => {
    const zip = new JSZip();
    zip.file("large.txt", "x".repeat(600 * 1024));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    replaceDeclaredEntrySizes(bytes, 1);

    const preview = await loadDocumentPreview(bytes, "archive", "large.zip");
    expect(preview.type).toBe("archive");
    if (preview.type !== "archive") return;
    await expect(preview.readTextEntry("large.txt")).rejects.toMatchObject({
      code: "archive_too_large",
    });
  });
});
