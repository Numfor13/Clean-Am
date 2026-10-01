// Browser-side access to the CLEAN-AM API.
//
// The browser never talks to API Gateway or Cognito directly. It calls this
// app's own /api routes, which hold the tokens in httpOnly cookies and attach
// them server-side (see src/app/api/backend/[...path]/route.ts). The one
// exception is the photo itself, which goes straight to S3 on a presigned URL.

import type { ApiError } from "./types";

export class ApiRequestError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        // Custom header = CSRF guard: a cross-site form cannot set it.
        "X-CAM-CSRF": "1",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, {
      code: "NETWORK",
      message: "No connection. Check your network and try again.",
    });
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: ApiError } | null)?.error;
    throw new ApiRequestError(response.status, {
      code: error?.code ?? (response.status === 401 ? "UNAUTHORIZED" : `HTTP_${response.status}`),
      message: error?.message ?? "Something went wrong. Please try again.",
      details: error?.details,
    });
  }
  return payload as T;
}

/** Call the backend API through this app's proxy. `path` has no leading slash. */
export const api = {
  get: <T>(path: string, query?: Query) => send<T>(`/api/backend/${path}${buildQuery(query)}`, "GET"),
  post: <T>(path: string, body: unknown = {}) => send<T>(`/api/backend/${path}`, "POST", body),
  patch: <T>(path: string, body: unknown = {}) => send<T>(`/api/backend/${path}`, "PATCH", body),
  del: <T>(path: string) => send<T>(`/api/backend/${path}`, "DELETE"),
};

/**
 * One page of reports. With filters on, the API can answer an empty page that
 * still has a cursor (nothing matched in the stretch it read); keep going a
 * few times so the screen never says "no results" while more exist.
 */
export async function getReportPage<T extends { reports: unknown[]; next_cursor: string | null }>(
  path: string,
  query: Query,
): Promise<T> {
  let page = await api.get<T>(path, query);
  for (let hops = 0; page.reports.length === 0 && page.next_cursor && hops < 5; hops++) {
    page = await api.get<T>(path, { ...query, cursor: page.next_cursor });
  }
  return page;
}

/** Call one of this app's auth endpoints (src/app/api/auth/[action]). */
export function authCall<T = AuthResult>(action: string, body: unknown = {}): Promise<T> {
  return send<T>(`/api/auth/${action}`, "POST", body);
}

/** What every auth endpoint answers with: where to go next. */
export interface AuthResult {
  ok: boolean;
  /** Path to navigate to, e.g. "/home" or "/verify?purpose=signup". */
  next?: string;
  /** A masked destination for a code that was just sent. */
  destination?: string;
  message?: string;
}

/** Make sure this browser has a guest identity; returns its label. */
export function ensureGuest(): Promise<{ guest_label: string }> {
  return send(`/api/guest/session`, "POST", {});
}

/**
 * PUT the photo to S3 on the presigned URL, reporting progress. XHR rather
 * than fetch because fetch has no upload progress, and on a slow connection
 * a moving bar is what stops people giving up.
 */
export function uploadPhoto(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (percent: number) => void,
): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new ApiRequestError(xhr.status, { code: "UPLOAD_FAILED", message: "Upload failed." }));
      }
    };
    xhr.onerror = () => reject(new ApiRequestError(0, { code: "NETWORK", message: "Upload failed." }));
    xhr.onabort = () => reject(new ApiRequestError(0, { code: "ABORTED", message: "Upload cancelled." }));
    xhr.send(blob);
  });
  return { promise, abort: () => xhr.abort() };
}
