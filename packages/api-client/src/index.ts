export { createApiClient, ApiError } from "./client";
export type { ApiClient, ApiClientConfig } from "./client";
export { createForeclosureApi } from "./endpoints";
export type { ForeclosureApi } from "./endpoints";

import { createApiClient, type ApiClientConfig } from "./client";
import { createForeclosureApi } from "./endpoints";

/** Convenience: build the full typed client in one call. */
export function createForeclosureDataClient(config: ApiClientConfig = {}) {
  return createForeclosureApi(createApiClient(config));
}
