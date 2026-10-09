import { getAccessToken, invalidateAccessToken } from "./auth";

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 5,
  delay = 1000,
): Promise<Response> {
  const originalHeaders = new Headers(options.headers);

  const attempt = async (index: number): Promise<Response> => {
    if (index >= retries) {
      throw new Error("Gagal melakukan fetch setelah beberapa kali percobaan.");
    }

    let response: Response;
    try {
      response = await fetch(url, options);
      if (response.status === 401) {
        await invalidateAccessToken();
        const newToken = await getAccessToken();
        originalHeaders.set("Authorization", `Bearer ${newToken}`);
        options.headers = originalHeaders;
        if (index === retries - 1) {
          throw new Error(
            "Gagal melakukan fetch setelah beberapa kali percobaan.",
          );
        }
        return attempt(index + 1);
      }
    } catch (error: unknown) {
      if (index === retries - 1) throw error;
      await new Promise((res) => setTimeout(res, delay * Math.pow(2, index)));
      return attempt(index + 1);
    }

    if (response.ok || response.status === 404) return response;

    if (response.status === 429 || response.status >= 500) {
      await new Promise((res) => setTimeout(res, delay * Math.pow(2, index)));
      return attempt(index + 1);
    }

    return response;
  };

  return attempt(0);
}
