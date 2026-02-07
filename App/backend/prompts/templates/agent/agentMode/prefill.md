{{#if (eq config.thinkingMode "model")}}<thinking>
Let me execute this carefully:
- Run mode: Agent Mode
- Surface: {{agent.surface}}
- Language: {{ config.mainLanguage }}

I'll decide whether to use tools and/or delegate to Sub Agents.
</thinking>

{{/if}}I'll help you execute and edit. I'll respond in {{ config.mainLanguage }}.

