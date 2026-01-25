/**
 * Base API client with authentication and error handling
 */

const rawBaseUrl = (import.meta.env.VITE_API_URL || '').trim();
export const API_BASE_URL = rawBaseUrl ? rawBaseUrl.replace(/\/+$/, '') : '';

export class ApiError extends Error {
  status: number;
  data?: any;

  constructor(
    message: string,
    status: number,
    data?: any
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// Optional request options (e.g., AbortSignal for cancellation)
export type RequestOptions = { signal?: AbortSignal };

class ApiClient {
  private baseURL: string;
  private authToken: string | null = null;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
    // Load token from localStorage on initialization
    this.authToken = localStorage.getItem('auth_token');
  }

  setAuthToken(token: string | null) {
    this.authToken = token;
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  clearAuthToken() {
    this.setAuthToken(null);
  }

  private getHeaders(customHeaders?: Record<string, string>): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  async request<T>(
    method: string,
    path: string,
    data?: any,
    customHeaders?: Record<string, string>,
    requestOptions?: RequestOptions
  ): Promise<T> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseURL}${normalizedPath}`;

    const init: RequestInit = {
      method,
      headers: this.getHeaders(customHeaders),
      signal: requestOptions?.signal,
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      init.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, init);

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        let errorMessage = responseData?.detail || response.statusText || 'Request failed';

        // Format validation errors (422)
        if (Array.isArray(errorMessage)) {
          errorMessage = errorMessage.map(err =>
            typeof err === 'object' ? `${err.loc?.join('.')}: ${err.msg}` : String(err)
          ).join(', ');
        }

        console.error('API Error:', {
          url,
          method,
          status: response.status,
          message: errorMessage,
          requestData: data,
          responseData: responseData
        });
        throw new ApiError(
          errorMessage,
          response.status,
          responseData
        );
      }

      return responseData as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      // Network error or other fetch errors
      throw new ApiError(
        error instanceof Error ? error.message : 'Network error',
        0
      );
    }
  }

  async get<T>(path: string, customHeaders?: Record<string, string>, requestOptions?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, customHeaders, requestOptions);
  }

  async post<T>(path: string, data?: any, customHeaders?: Record<string, string>, requestOptions?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, data, customHeaders, requestOptions);
  }

  async put<T>(path: string, data?: any, customHeaders?: Record<string, string>, requestOptions?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, data, customHeaders, requestOptions);
  }

  async patch<T>(path: string, data?: any, customHeaders?: Record<string, string>, requestOptions?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, data, customHeaders, requestOptions);
  }

  async delete<T>(path: string, customHeaders?: Record<string, string>, requestOptions?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, customHeaders, requestOptions);
  }

  async postFormData<T>(path: string, formData: FormData, requestOptions?: RequestOptions): Promise<T> {
    const url = `${this.baseURL}${path}`;

    const headers: HeadersInit = {};
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    // Don't set Content-Type - browser will set it with boundary for multipart/form-data

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: requestOptions?.signal,
      });

      if (response.status === 204) {
        return undefined as T;
      }

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        let errorMessage = responseData?.detail || response.statusText || 'Request failed';
        if (Array.isArray(errorMessage)) {
          errorMessage = errorMessage.map(err =>
            typeof err === 'object' ? `${err.loc?.join('.')}: ${err.msg}` : String(err)
          ).join(', ');
        }
        throw new ApiError(errorMessage, response.status, responseData);
      }

      return responseData as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        error instanceof Error ? error.message : 'Network error',
        0
      );
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient;
