export function normalizeBaseUrl(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function isLoopbackBaseUrl(input: string | null | undefined): boolean {
  const normalized = normalizeBaseUrl(input);
  if (!normalized) {
    return false;
  }

  try {
    const url = new URL(normalized);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function resolveRequestBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
  const protocol = forwardedProto || requestUrl.protocol.replace(/:$/, "");

  if (host) {
    return `${protocol}://${host}`.replace(/\/+$/, "");
  }

  return requestUrl.origin.replace(/\/+$/, "");
}

export function resolveWebhookBaseUrlForRequest(request: Request): string {
  const configured = normalizeBaseUrl(process.env.TWILIO_WEBHOOK_BASE_URL) || normalizeBaseUrl(process.env.APP_BASE_URL);
  const requestBase = resolveRequestBaseUrl(request);

  if (!configured) {
    return requestBase;
  }

  if (isLoopbackBaseUrl(configured) && !isLoopbackBaseUrl(requestBase)) {
    return requestBase;
  }

  return configured;
}

export function resolveWebhookRequestUrl(request: Request): string {
  const base = resolveWebhookBaseUrlForRequest(request);
  const requestUrl = new URL(request.url);
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, `${base}/`).toString();
}

export function resolveWebhookPathUrl(request: Request, path: string): string {
  return new URL(path, `${resolveWebhookBaseUrlForRequest(request)}/`).toString();
}
