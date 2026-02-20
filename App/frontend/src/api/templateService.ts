/**
 * API service for template rendering and validation
 */
import { apiClient } from './client';

interface RenderResponse {
  rendered: string;
  error: string | null;
}

interface ValidateResponse {
  is_valid: boolean;
  error: string | null;
}

export const templateService = {
  async render(
    templateContent: string,
    data: Record<string, any>,
  ): Promise<RenderResponse> {
    return apiClient.post<RenderResponse>('/api/v1/templates/render', {
      template_content: templateContent,
      data,
    });
  },

  async validate(templateContent: string): Promise<ValidateResponse> {
    return apiClient.post<ValidateResponse>('/api/v1/templates/validate', {
      template_content: templateContent,
    });
  },
};
