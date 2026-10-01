type FetchOptionsWithMixedBody = Omit<RequestInit, "body"> & { body?: unknown };

const JSON_INIT_UPLOAD_PATHS = new Set([
  "/api/file-request/upload",
  "/api/files/upload",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonInitUpload(url: string) {
  try {
    return JSON_INIT_UPLOAD_PATHS.has(
      new URL(url, "https://vaehor.invalid").pathname,
    );
  } catch {
    return false;
  }
}

export async function mixedUploadFetch<T>(
  url: string,
  options: FetchOptionsWithMixedBody,
): Promise<T> {
  const { body, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  const jsonInitBody = isJsonInitUpload(url) && isPlainObject(body);
  if (jsonInitBody) headers.set("Content-Type", "application/json");

  const response = await fetch(url, {
    ...requestOptions,
    headers,
    body: (jsonInitBody ? JSON.stringify(body) : body) as
      | BodyInit
      | null
      | undefined,
  });
  const text = [204, 205, 304].includes(response.status)
    ? null
    : await response.text();
  return {
    data: text ? JSON.parse(text) : {},
    status: response.status,
    headers: response.headers,
  } as T;
}
