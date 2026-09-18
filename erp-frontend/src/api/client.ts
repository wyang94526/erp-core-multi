/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 *
 * API Client using native Fetch API
 * Provides a base client for making HTTP requests to the backend
 */

// Empty = same-origin (Vite proxy in dev). Override with VITE_API_BASE_URL if needed.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export const AUTH_TOKEN_KEY = 'erp.authToken';

export interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Builds a URL with query parameters
 */
function buildUrl(endpoint: string, params?: Record<string, string | number | boolean | null | undefined>): string {
  const path = `${API_BASE_URL}${endpoint}`;

  if (!params || Object.keys(params).length === 0) {
    return path;
  }

  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const text = String(value);
    if (text === '' || text === 'undefined' || text === 'null') return;
    search.append(key, text);
  });
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Formats FastAPI error payloads into a readable message.
 * `detail` may be a string or a list of validation error objects.
 */
function formatApiError(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === 'string') return item
          if (typeof item === 'object' && item !== null) {
            const err = item as { loc?: unknown[]; msg?: string }
            const loc = Array.isArray(err.loc)
              ? err.loc.filter((p) => p !== 'body').join('.')
              : ''
            const msg = err.msg || JSON.stringify(item)
            return loc ? `${loc}: ${msg}` : msg
          }
          return String(item)
        })
        .join('; ')
    }
    if (detail != null) return String(detail)
  }
  return fallback
}

export function getStoredAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setStoredAuthToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY)
  }
  // Clear legacy impersonation key
  localStorage.removeItem('erp.activeUserId')
}

/**
 * Makes an HTTP request and handles errors
 */
async function request<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { params, ...fetchOptions } = options;

  const url = buildUrl(endpoint, params);

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const token = getStoredAuthToken();
  if (token) {
    (defaultHeaders as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const signal =
    fetchOptions.signal ??
    (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(45_000)
      : undefined);

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal,
      headers: {
        ...defaultHeaders,
        ...fetchOptions.headers,
      },
    });
  } catch (err) {
    const name = err instanceof DOMException || err instanceof Error ? err.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new Error('The server took too long to respond. Try again, or save as Draft first.');
    }
    const message =
      err instanceof TypeError
        ? 'Cannot reach the API. Check that the backend is running (port 8000).'
        : err instanceof Error
          ? err.message
          : 'Network request failed';
    throw new Error(message);
  }

  // Handle non-JSON responses
  const contentType = response.headers.get('content-type');
  let data: unknown;

  if (contentType?.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  // Handle error responses
  if (!response.ok) {
    const error = new Error(
      formatApiError(data, `HTTP ${response.status}: ${response.statusText}`)
    );
    (error as any).status = response.status;
    (error as any).data = data;
    throw error;
  }

  return data as T;
}

/**
 * API Client with convenience methods
 */
export const apiClient = {
  /**
   * GET request
   */
  get<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'GET',
    });
  },

  /**
   * POST request
   */
  post<T>(endpoint: string, body?: unknown, options?: FetchOptions): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });
  },

  /**
   * PATCH request
   */
  patch<T>(endpoint: string, body?: unknown, options?: FetchOptions): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });
  },

  /**
   * PUT request
   */
  put<T>(endpoint: string, body?: unknown, options?: FetchOptions): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });
  },

  /**
   * DELETE request
   */
  delete<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'DELETE',
    });
  },

  /**
   * POST multipart form data (do not set JSON Content-Type).
   */
  async upload<T>(endpoint: string, formData: FormData): Promise<T> {
    const url = buildUrl(endpoint);
    const headers: Record<string, string> = {};
    const token = getStoredAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Cannot reach the API. Check that the backend is running (port 8000).'
          : err instanceof Error
            ? err.message
            : 'Network request failed';
      throw new Error(message);
    }

    const contentType = response.headers.get('content-type');
    let data: unknown;
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const error = new Error(
        formatApiError(data, `HTTP ${response.status}: ${response.statusText}`),
      );
      throw error;
    }
    return data as T;
  },

  /**
   * GET a file as a Blob (authenticated).
   */
  async fetchBlob(endpoint: string): Promise<Blob> {
    const url = buildUrl(endpoint);
    const headers: Record<string, string> = {};
    const token = getStoredAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Cannot reach the API. Check that the backend is running (port 8000).'
          : err instanceof Error
            ? err.message
            : 'Network request failed';
      throw new Error(message);
    }

    if (!response.ok) {
      let data: unknown;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      throw new Error(formatApiError(data, `HTTP ${response.status}: ${response.statusText}`));
    }

    const blob = await response.blob();
    const type = response.headers.get('content-type') || blob.type;
    return type && blob.type !== type ? new Blob([blob], { type }) : blob;
  },

  /**
   * GET a file and trigger a browser download.
   */
  async download(endpoint: string, filename: string): Promise<void> {
    const blob = await apiClient.fetchBlob(endpoint);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },

  /**
   * Open a file in a new tab using the browser viewer (PDF/images).
   */
  async openInViewer(endpoint: string, filename: string): Promise<void> {
    const tab = window.open('about:blank', '_blank');
    try {
      const blob = await apiClient.fetchBlob(endpoint);
      const objectUrl = URL.createObjectURL(blob);
      if (tab) {
        tab.location.replace(objectUrl);
        tab.document.title = filename;
      } else {
        window.open(objectUrl, '_blank', 'noopener');
      }
    } catch (err) {
      tab?.close();
      throw err;
    }
  },
};

export default apiClient;
