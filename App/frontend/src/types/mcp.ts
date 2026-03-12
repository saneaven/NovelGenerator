export interface McpHeaderInput {
  name: string;
  value: string;
}

export type McpAuthInput =
  | { auth_kind: 'none' }
  | { auth_kind: 'bearer'; token: string }
  | { auth_kind: 'headers'; headers: McpHeaderInput[] };

export interface McpCatalogTool {
  local_name: string;
  remote_name: string;
  title?: string | null;
  description?: string | null;
  input_schema: Record<string, unknown>;
  annotations?: Record<string, unknown> | null;
}

export interface McpCatalogPromptArgument {
  name: string;
  description?: string | null;
  required: boolean;
}

export interface McpCatalogPrompt {
  name: string;
  title?: string | null;
  description?: string | null;
  arguments: McpCatalogPromptArgument[];
}

export interface McpCatalogResource {
  uri: string;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  mime_type?: string | null;
}

export interface McpCatalogSupports {
  tools: boolean;
  prompts: boolean;
  resources: boolean;
  resource_templates: boolean;
  roots: boolean;
  elicitation: boolean;
  sampling: boolean;
  tasks: boolean;
}

export interface NormalizedMcpCatalog {
  supports: McpCatalogSupports;
  tools: McpCatalogTool[];
  prompts: McpCatalogPrompt[];
  resources: McpCatalogResource[];
  resource_templates: Record<string, unknown>[];
}

export interface McpServerSnapshot {
  protocol_version: string | null;
  server_info: Record<string, unknown>;
  capabilities_raw: Record<string, unknown>;
  catalog: NormalizedMcpCatalog;
  sync_error: string | null;
  synced_at: string | null;
}

export interface McpServerResponse {
  id: string;
  server_key: string;
  display_name: string;
  server_url: string;
  enabled: boolean;
  allow_agent_mode: boolean;
  allow_plan_mode: boolean;
  auth_kind: 'none' | 'bearer' | 'headers';
  snapshot: McpServerSnapshot;
}

export interface McpServerCreate {
  server_key: string;
  display_name: string;
  server_url: string;
  enabled: boolean;
  allow_agent_mode: boolean;
  allow_plan_mode: boolean;
  auth: McpAuthInput;
}

export interface McpServerUpdate {
  server_key?: string;
  display_name?: string;
  server_url?: string;
  enabled?: boolean;
  allow_agent_mode?: boolean;
  allow_plan_mode?: boolean;
  auth?: McpAuthInput;
}

export type McpSelection =
  | {
      selection_id: string;
      server_id: string;
      kind: 'prompt';
      prompt_name: string;
      arguments?: Record<string, unknown>;
    }
  | {
      selection_id: string;
      server_id: string;
      kind: 'resource';
      resource_uri: string;
    };

export interface McpSelectionAudit {
  selection_id: string;
  server_id: string;
  kind: 'prompt' | 'resource';
  source_label: string;
  summary_label: string;
  raw_ref?: Record<string, unknown>;
}
