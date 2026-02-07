// Product-level agent runtime concepts.
//
// - WorkspaceSurface: right-side "work surface" the user is viewing.
// - AgentRunMode: left-side main agent execution mode (Plan vs Agent).
// - InvocationCaller: who is invoking a Sub Agent (root planMode/agentMode, or another sub agent).

export type WorkspaceSurface =
  | 'story-object'
  | 'outline-manager'
  | 'novel-editor'
  | 'config';

export type AgentRunMode = 'planMode' | 'agentMode';

export type InvocationCaller = 'planMode' | 'agentMode' | 'subAgent';
