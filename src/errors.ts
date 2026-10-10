export type AnthropicErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "api_error";

/** Builds an error response in the Anthropic API's error shape. */
export function errorResponse(
  status: number,
  type: AnthropicErrorType,
  message: string,
): Response {
  return Response.json(
    { type: "error", error: { type, message } },
    { status, headers: { "x-claude-proxy-error": "1" } },
  );
}
