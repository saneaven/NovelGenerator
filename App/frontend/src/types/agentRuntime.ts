// Product-level agent runtime concepts.
//
// - WorkspaceSurface: right-side "work surface" the user is viewing.
// - AgentRunMode: left-side main agent execution mode (Plan vs Agent).
// - RunCaller: who is creating a run (root planMode/agentMode, or another sub agent).

export type WorkspaceSurface =
  | 'story-entity'
  | 'outline-manager'
  | 'novel-editor'
  | 'config';

export type AgentRunMode = 'planMode' | 'agentMode';

export type RunCaller = 'planMode' | 'agentMode' | 'subAgent';
