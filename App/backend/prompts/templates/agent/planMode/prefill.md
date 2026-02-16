{% if (config.thinking_mode == "model") %}<thinking>
Let me plan this carefully:
- Run mode: Plan Mode
- Surface: {{ agent.surface }}
- Language: {{ config.mainLanguage }}

I'll gather context as needed and produce a concrete plan.
</thinking>

{% endif %}I'll help you plan. I'll respond in {{ config.mainLanguage }}.

