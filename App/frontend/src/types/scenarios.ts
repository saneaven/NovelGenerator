export type TaskType = 'agent' | 'memory' | 'translation' | 'editAssistant' | 'imagePrompt' | 'subAgent';

export type ScenarioBlockType = 'staticPrompt' | 'rangeMapping';
export type StaticPromptSubtype = 'normal' | 'memory';
export type StaticRole = 'user' | 'assistant';

export interface ScenarioStaticPrompt {
  subtype: StaticPromptSubtype;
  role: StaticRole;
  template: string;
}

export interface ScenarioRangeMapping {
  start_index: number;
  end_index: number;
  user_template: string;
  assistant_template: string;
}

export interface ScenarioBlock {
  id: string;
  block_order: number;
  enabled: boolean;
  type: ScenarioBlockType;
  staticPrompt?: ScenarioStaticPrompt;
  rangeMapping?: ScenarioRangeMapping;
}

export interface ScenarioDocument {
  system_template: string;
  blocks: ScenarioBlock[];
}

