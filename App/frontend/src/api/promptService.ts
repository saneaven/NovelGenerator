/**
 * API service for prompt management
 */
import { apiClient } from './client';
import type { FunctionType, PromptCategory } from '../prompts/defaults';

export interface PromptContent {
  content: string;
  version_number: number;
  created_at: string;
  is_default: boolean;
}

export interface PromptVersion {
  id: string;
  version_number: number;
  content: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  note?: string;
}

export interface VersionHistoryItem {
  version_number: number;
  created_at: string;
  note?: string;
  is_active: boolean;
  is_default: boolean;
  preview: string;
}

export interface ValidationError {
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface SyntaxCatalogEntry {
  name: string;
  description?: string;
  type?: string;
  source?: string;
  example?: string;
  default?: any;
  supports_negation?: boolean;
}

export interface TemplatePlaceholderInfo extends SyntaxCatalogEntry {
  required: boolean;
}

export interface TemplatePlaceholderGroup {
  variables: TemplatePlaceholderInfo[];
  contexts: TemplatePlaceholderInfo[];
  conditionals: TemplatePlaceholderInfo[];
}

export interface TemplateSyntaxInfo {
  id?: string;
  function_type?: string;
  category?: string;
  variant?: string;
  description?: string;
  placeholders: TemplatePlaceholderGroup;
}

export interface PromptSyntaxMetadata {
  version?: string;
  catalog: {
    variables: SyntaxCatalogEntry[];
    contexts: SyntaxCatalogEntry[];
    conditionals: SyntaxCatalogEntry[];
  };
  templates: TemplateSyntaxInfo[];
}

/**
 * Build API path for prompt
 */
function buildPromptPath(
  functionType: FunctionType,
  category: PromptCategory,
  name?: string
): string {
  const base = `/api/v1/prompts/${functionType}/${category}`;
  return name ? `${base}/${name}` : base;
}

export const promptService = {
  /**
   * Get active prompt content
   */
  async getPrompt(
    functionType: FunctionType,
    category: PromptCategory,
    name?: string
  ): Promise<PromptContent> {
    const path = buildPromptPath(functionType, category, name);
    return await apiClient.get<PromptContent>(path);
  },

  /**
   * Save new version of a prompt
   */
  async savePrompt(
    functionType: FunctionType,
    category: PromptCategory,
    content: string,
    note?: string,
    name?: string
  ): Promise<PromptVersion> {
    const path = buildPromptPath(functionType, category, name);
    return await apiClient.post<PromptVersion>(`${path}/save`, {
      content,
      note,
    });
  },

  /**
   * Get version history for a prompt
   */
  async getVersionHistory(
    functionType: FunctionType,
    category: PromptCategory,
    name?: string
  ): Promise<VersionHistoryItem[]> {
    const path = buildPromptPath(functionType, category, name);
    return await apiClient.get<VersionHistoryItem[]>(`${path}/versions`);
  },

  /**
   * Restore a specific version
   */
  async restoreVersion(
    functionType: FunctionType,
    category: PromptCategory,
    versionNumber: number,
    name?: string
  ): Promise<void> {
    const path = buildPromptPath(functionType, category, name);
    await apiClient.post(`${path}/restore`, {
      version_number: versionNumber,
    });
  },

  /**
   * Validate template syntax
   */
  async validateTemplate(content: string): Promise<ValidationResult> {
    return await apiClient.post<ValidationResult>('/api/v1/prompts/validate', {
      content,
    });
  },

  /**
   * Fetch syntax metadata describing available placeholders and templates.
   */
  async getSyntaxMetadata(): Promise<PromptSyntaxMetadata> {
    return await apiClient.get<PromptSyntaxMetadata>('/api/v1/prompts/syntax/metadata');
  },
};
