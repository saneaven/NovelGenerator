from __future__ import annotations

from ..shared.contracts import (
    Condition,
    EmbeddingSpec,
    FieldSpec,
    LLMVariantSpec,
    LLMSpec,
    ObjectSpec,
    ProviderSpec,
    ProviderUI,
    RuntimeSpec,
    UIHint,
)


SPEC = ProviderSpec(
    id="ollama_cloud",
    ui=ProviderUI(
        display_name_key="settings.credentials.ollamaCloud.title",
        icon_key="ollama_cloud",
        description_key="settings.taskConfig.providerDescriptions.ollamaCloud",
        llm_order=55,
        embedding_order=35,
        model_browser_grouping_llm="provider_family",
        model_browser_grouping_embedding="provider_family",
    ),
    credentials=ObjectSpec(fields={
        "api_key": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="password",
                label_key="settings.credentials.apiKey",
                placeholder_key="settings.credentials.ollamaCloud.placeholder",
                help_key="settings.credentials.getApiKeyFrom",
                link_url="https://ollama.com/settings/keys",
                link_label="ollama.com/settings/keys",
            ),
        ),
    }),
    llm=LLMSpec(
        common_task_config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="ollama_cloud", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "temperature": FieldSpec(kind="number", default=0.7, expose=False, min_value=0, max_value=2, step=0.1),
            "provider_preference": FieldSpec(kind="object", expose=False),
            "max_output_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1, max_value=1000000),
            "context_window_tokens": FieldSpec(kind="int", default=None, expose=False, min_value=1024, max_value=1000000),
            "advanced": ObjectSpec(fields={
                "thinking_mode": FieldSpec(
                    kind="enum",
                    default="off",
                    options=("off", "model", "custom"),
                    ui=UIHint(widget="radio_cards", label_key="settings.taskConfig.thinking_mode", order=10),
                ),
                "thinking_config": ObjectSpec(
                    when=(Condition(op="eq", path="advanced.thinking_mode", value="model"),),
                    fields={
                        "effort": FieldSpec(
                            kind="enum",
                            default="medium",
                            options=("low", "medium", "high"),
                            ui=UIHint(
                                widget="select",
                                label_key="settings.taskConfig.thinking_config.effortLevel",
                                help_key="settings.taskConfig.thinking_config.effortHintGeneric",
                                option_label_prefix="settings.taskConfig.thinking_config.effortOptions",
                                order=20,
                            ),
                        ),
                    },
                ),
            }),
        }),
        variants={
            "default": LLMVariantSpec(
                id="default",
                runtime=RuntimeSpec(adapter="default"),
                task_config=ObjectSpec(fields={}),
            )
        },
        default_variant="default",
        supports_tools=True,
        supports_thinking=True,
    ),
    embedding=EmbeddingSpec(
        runtime=RuntimeSpec(adapter="default"),
        config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="ollama_cloud", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "dimensions": FieldSpec(kind="int", default=None, expose=False),
        }),
    ),
)
