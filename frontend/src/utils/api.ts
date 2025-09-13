// API utility functions for making HTTP requests

import { TokenManager } from '../services/authService';

// Defensive API_BASE_URL construction
let API_BASE_URL: string;
if (process.env.REACT_APP_API_URL) {
  // Ensure the API_BASE_URL always ends with /api
  const baseUrl = process.env.REACT_APP_API_URL.trim();
  if (baseUrl.endsWith('/api')) {
    API_BASE_URL = baseUrl;
  } else {
    API_BASE_URL = baseUrl.endsWith('/') ? baseUrl + 'api' : baseUrl + '/api';
  }
} else {
  API_BASE_URL = 'http://localhost:5000/api';
}

// Debug: Log environment variable loading immediately
console.log('API Utility Loaded - Environment Check:', {
  REACT_APP_API_URL: process.env.REACT_APP_API_URL,
  API_BASE_URL: API_BASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  'Fixed URL': API_BASE_URL
});

export interface ApiRequestOptions extends RequestInit {
  timeout?: number;
}

/**
 * Generic API request function with error handling and timeout
 */
export const apiRequest = async (
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<Response> => {
  const { timeout = 10000, ...fetchOptions } = options;
  
  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    
    // Debug logging for URL construction
    console.log('API Request Debug:', {
      endpoint,
      API_BASE_URL,
      finalUrl: url,
      envVar: process.env.REACT_APP_API_URL
    });
    
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
    
    throw new Error('Network error');
  }
};

/**
 * Attempt to silently refresh token; on failure, auto-logout and redirect.
 */
async function handleAuthFailureAndMaybeRetry(
  endpoint: string,
  options: ApiRequestOptions
): Promise<Response> {
  try {
    const newToken = await TokenManager.refreshToken();
    const retryHeaders = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${newToken}`,
    } as Record<string, string>;

    return apiRequest(endpoint, { ...options, headers: retryHeaders });
  } catch (refreshError) {
    console.error('Silent refresh failed in fetch utils:', refreshError);
    // Clear tokens and notify app
    TokenManager.clearTokens();
    try {
      window.dispatchEvent(new CustomEvent('session-expired'));
      window.dispatchEvent(new CustomEvent('session-expired-dialog'));
    } catch {}
    // Redirect to login if not already there
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
    throw refreshError instanceof Error ? refreshError : new Error('Unauthorized');
  }
}

/**
 * API request with automatic token handling and auto-logout on 401/403.
 */
export const authenticatedApiRequest = async (
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<Response> => {
  const token = TokenManager.getAccessToken() || localStorage.getItem('accessToken');
  
  const authOptions: ApiRequestOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };

  const response = await apiRequest(endpoint, authOptions);

  if (response.status === 401 || response.status === 403) {
    // Try a one-time silent refresh, then retry the request
    return handleAuthFailureAndMaybeRetry(endpoint, authOptions);
  }

  return response;
};

/**
 * Helper for GET requests
 */
export const apiGet = async (endpoint: string): Promise<Response> => {
  return authenticatedApiRequest(endpoint, { method: 'GET' });
};

/**
 * Helper for POST requests
 */
export const apiPost = async (
  endpoint: string,
  data: any
): Promise<Response> => {
  return authenticatedApiRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

/**
 * Helper for PUT requests
 */
export const apiPut = async (
  endpoint: string,
  data: any
): Promise<Response> => {
  return authenticatedApiRequest(endpoint, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

/**
 * Helper for PATCH requests
 */
export const apiPatch = async (
  endpoint: string,
  data: any
): Promise<Response> => {
  return authenticatedApiRequest(endpoint, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
};

/**
 * Helper for DELETE requests
 */
export const apiDelete = async (endpoint: string): Promise<Response> => {
  return authenticatedApiRequest(endpoint, { method: 'DELETE' });
};

/**
 * Error handling helper
 */
export const handleApiError = async (response: Response): Promise<never> => {
  let errorMessage = 'An error occurred';
  
  try {
    const errorData = await response.json();
    errorMessage = errorData.error || errorData.message || errorMessage;
  } catch {
    errorMessage = `HTTP ${response.status}: ${response.statusText}`;
  }
  
  throw new Error(errorMessage);
};

/**
 * Check if response is successful and parse JSON
 */
export const parseApiResponse = async <T = any>(response: Response): Promise<T> => {
  if (!response.ok) {
    await handleApiError(response);
  }
  
  return response.json();
};
