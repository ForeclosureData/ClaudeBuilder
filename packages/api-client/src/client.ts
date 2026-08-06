import { z } from "zod";

export interface ApiClientConfig {
  /** Base URL of the web app's API, e.g. https://app.foreclosuredata.com or http://localhost:3100 for mobile-against-local-web. Web itself can omit this and use relative paths. */
  baseUrl?: string;
  /** Mobile must supply this (the Supabase access token); web relies on the session cookie instead and can omit it. */
  getAccessToken?: () => Promise<string | null>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

/**
 * Every request/response is parsed through a shared Zod schema — a
 * malformed server response throws loudly instead of producing a silently
 * wrong UI on either platform.
 */
export function createApiClient(config: ApiClientConfig = {}) {
  async function request<TResponseSchema extends z.ZodTypeAny>(
    path: string,
    responseSchema: TResponseSchema,
    init?: RequestInit,
  ): Promise<z.infer<TResponseSchema>> {
    const url = `${config.baseUrl ?? ""}${path}`;
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");

    if (config.getAccessToken) {
      const token = await config.getAccessToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(url, {
      ...init,
      headers,
      credentials: config.getAccessToken ? "omit" : "include",
    });

    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      throw new ApiError(
        (body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : response.statusText) ||
          "Request failed",
        response.status,
        body,
      );
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(`Response from ${path} did not match the expected schema: ${parsed.error.message}`, response.status, body);
    }
    return parsed.data;
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;
