import { readFile, writeFile } from "node:fs/promises";

const sdkPath = new URL("../packages/sdk/src/orval/index.ts", import.meta.url);
let source = await readFile(sdkPath, "utf8");

const generatedHeader = " * OpenAPI spec version: 0.0.0\n */";
const helper = `

function toSdkUploadBody(body: string | Blob | object): BodyInit {
  if (typeof body === "string") return body;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body;
  return JSON.stringify(body) ?? "";
}
`;

if (!source.includes("function toSdkUploadBody(")) {
  if (!source.includes(generatedHeader)) {
    throw new Error("Could not locate the generated SDK header.");
  }
  source = source.replace(generatedHeader, `${generatedHeader}${helper}`);
}

for (const parameter of ["uploadToFileRequestBody", "uploadFileBody"]) {
  const generatedBody = `body: ${parameter}`;
  const normalizedBody = `body: toSdkUploadBody(${parameter})`;
  if (source.includes(normalizedBody)) continue;

  const occurrences = source.split(generatedBody).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected one generated ${generatedBody} assignment, found ${occurrences}.`,
    );
  }
  source = source.replace(generatedBody, normalizedBody);
}

source = source.replace(
  /(export type downloadFileResponse200 = \{\n  data: )unknown(;\n  status: 200;\n\};)/,
  "$1Blob$2",
);

await writeFile(sdkPath, source);
