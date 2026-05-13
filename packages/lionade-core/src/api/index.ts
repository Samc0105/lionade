/**
 * @lionade/core/api — HTTP client surface.
 *
 * Re-exports the platform-agnostic createApiClient plus its types.
 * Per-feature method modules (spin, quiz, mastery, missions) are imported
 * via subpath: `@lionade/core/api/spin`, etc.
 */
export {
  createApiClient,
  type ApiClient,
  type ApiClientConfig,
  type ApiResult,
  type HttpMethod,
} from "./http.js";
