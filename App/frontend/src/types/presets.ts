/**
 * Types for prompt preset management
 */

import type { SubAgentDefinition } from './subAgents';
import type { ScenarioDocument } from './scenarios';

/**
 * Preset list item (minimal info for list display)
 */
export interface PresetListItem {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Full preset response with counts
 */
export interface PresetResponse {
  id: string;
  name: string;
  description: string | null;
  prompt_count: number;
  fragment_count: number;
  variable_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Preset with full details including active status
 */
export interface PresetDetailResponse {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  prompt_count: number;
  fragment_count: number;
  variable_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Active preset info response
 */
export interface ActivePresetResponse {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Request to create a new preset
 */
export interface PresetCreate {
  name: string;
  description?: string;
  initialize_with_defaults?: boolean;
}

/**
 * Request to update preset metadata
 */
export interface PresetUpdate {
  name?: string;
  description?: string;
}

/**
 * Request to duplicate a preset
 */
export interface PresetDuplicateRequest {
  new_name: string;
  new_description?: string;
}

// --- Export/Import Types ---

/**
 * Exported fragment data structure
 */
export interface ExportFragmentData {
  content: string;
  description?: string | null;
}

/**
 * Exported variable data structure
 */
export interface ExportVariableData {
  name: string;
  var_type: 'string' | 'number' | 'boolean' | 'select';
  value: string | number | boolean | null;
  select_options?: string[] | null;
  number_options?: {
    min?: number | null;
    max?: number | null;
    step?: number | null;
    input_type?: 'input' | 'slider';
  } | null;
  description?: string | null;
  display_order: number;
}

/**
 * Complete preset export structure
 */
export interface PresetExportData {
  format_version: 1;
  preset: {
    name: string;
    description: string | null;
  };
  // Scenario v1: prompts payload is scenario documents per (task_type, task_subtype)
  prompts: Record<string, Record<string, ScenarioDocument>>;
  fragments: Record<string, Record<string, ExportFragmentData>>;
  variables: ExportVariableData[];
  sub_agents: SubAgentDefinition[];
  exported_at: string;
}

/**
 * Request to import a preset
 */
export interface PresetImportRequest {
  name: string;
  description?: string;
  data: PresetExportData;
}
