/**
 * Base API client with authentication and error handling
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
    customHeaders?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseURL}${path}`;

    const options: RequestInit = {
      method,
      headers: this.getHeaders(customHeaders),
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);

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

  async get<T>(path: string, customHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, customHeaders);
  }

  async post<T>(path: string, data?: any, customHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, data, customHeaders);
  }

  async put<T>(path: string, data?: any, customHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('PUT', path, data, customHeaders);
  }

  async patch<T>(path: string, data?: any, customHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('PATCH', path, data, customHeaders);
  }

  async delete<T>(path: string, customHeaders?: Record<string, string>): Promise<T> {
    return this.request<T>('DELETE', path, undefined, customHeaders);
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient;
