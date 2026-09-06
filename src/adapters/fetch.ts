import { USER_AGENT } from "../config.js";

export class FetchError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(url: string, status: number, statusText: string) {
    super(`HTTP ${status} ${statusText} for ${url}`);
    this.name = "FetchError";
    this.status = status;
    this.url = url;
  }
}

export async function fetchText(
  url: string,
  options: { accept?: string; timeoutMs?: number } = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: options.accept ?? "text/html,text/csv,*/*",
      },
    });
    if (!response.ok) {
      throw new FetchError(url, response.status, response.statusText);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
