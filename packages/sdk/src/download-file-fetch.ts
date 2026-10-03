export async function downloadFileFetch<T>(
  url: string,
  options: RequestInit,
): Promise<T> {
  const response = await fetch(url, options);
  const noBody = [204, 205, 304].includes(response.status);
  let data: unknown = {};

  if (!noBody && response.ok) {
    data = await response.blob();
  } else if (!noBody) {
    const text = await response.text().catch(() => "");
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }
  }

  return {
    data,
    status: response.status,
    headers: response.headers,
  } as T;
}
