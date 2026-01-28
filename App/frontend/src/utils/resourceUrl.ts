import { API_BASE_URL } from '../api/client';

/**
 * Get the absolute URL for a static landing/resource file served by the backend.
 *
 * Backend mount: `/storage/resources/*`
 */
export function getResourceUrl(fileName: string): string {
  const normalized = fileName.replace(/^\/+/, '');
  return `${API_BASE_URL}/storage/resources/${normalized}`;
}

