from __future__ import annotations

from ...contracts import (
    Condition,
    EmbeddingSpec,
    FieldSpec,
    ImageSpec,
    LLMVariantSpec,
    LLMSpec,
    ObjectSpec,
    ProviderSpec,
    ProviderUI,
    RuntimeSpec,
    UIHint,
)


SPEC = ProviderSpec(
    id="nanogpt",
    ui=ProviderUI(
        display_name_key="settings.credentials.nanogpt.title",
        icon_key="nanogpt",
        description_key="settings.taskConfig.providerDescriptions.nanogpt",
        llm_order=60,
        embedding_order=40,
        image_order=60,
        model_browser_grouping_llm="provider_family",
        llm_show_pricing=True,
        embedding_show_pricing=True,
    ),
    credentials=ObjectSpec(fields={
        "api_key": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="password",
                label_key="settings.credentials.apiKey",
                placeholder_key="settings.credentials.nanogpt.placeholder",
                help_key="settings.credentials.getApiKeyFrom",
                link_url="https://nano-gpt.com",
                link_label="nano-gpt.com",
            ),
        ),
    }),
    llm=LLMSpec(
        common_task_config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="nanogpt", expose=False),
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
                            options=("none", "minimal", "low", "medium", "high", "xhigh", "max"),
                            ui=UIHint(
                                widget="select",
                                label_key="settings.taskConfig.thinking_config.reasoningEffort",
                                help_key="settings.taskConfig.thinking_config.effortHint",
                                option_label_prefix="settings.taskConfig.thinking_config.effortOptions",
                                order=20,
                            ),
                        ),
                    },
                ),
                "provider_settings": ObjectSpec(
                    fields={
                        "billing": ObjectSpec(fields={
                            "billing_mode": FieldSpec(
                                kind="enum",
                                options=("paygo",),
                                ui=UIHint(
                                    label_key="settings.taskConfig.nanogpt.billing.billingMode",
                                    help_key="settings.taskConfig.nanogpt.billing.billingModeHint",
                                    order=10,
                                ),
                            ),
                            "service_tier": FieldSpec(
                                kind="enum",
                                options=("auto", "priority"),
                                ui=UIHint(
                                    label_key="settings.taskConfig.nanogpt.billing.serviceTier",
                                    help_key="settings.taskConfig.nanogpt.billing.serviceTierHint",
                                    order=20,
                                ),
                            ),
                        }),
                        "web": ObjectSpec(
                            group_toggle="enabled",
                            fields={
                            "enabled": FieldSpec(
                                kind="bool",
                                ui=UIHint(
                                    widget="toggle",
                                    label_key="settings.taskConfig.nanogpt.web.enabled",
                                    help_key="settings.taskConfig.nanogpt.web.enabledHint",
                                    order=10,
                                ),
                            ),
                            "provider": FieldSpec(
                                kind="string",
                                ui=UIHint(
                                    widget="text",
                                    label_key="settings.taskConfig.nanogpt.web.provider",
                                    placeholder_key="settings.taskConfig.nanogpt.web.providerPlaceholder",
                                    order=20,
                                ),
                            ),
                            "depth": FieldSpec(
                                kind="string",
                                ui=UIHint(
                                    widget="text",
                                    label_key="settings.taskConfig.nanogpt.web.depth",
                                    placeholder_key="settings.taskConfig.nanogpt.web.depthPlaceholder",
                                    order=30,
                                ),
                            ),
                            "search_context_size": FieldSpec(
                                kind="enum",
                                options=("low", "medium", "high"),
                                ui=UIHint(
                                    label_key="settings.taskConfig.nanogpt.web.searchContextSize",
                                    order=40,
                                ),
                            ),
                            "user_location": ObjectSpec(fields={
                                    "country": FieldSpec(
                                        kind="string",
                                        ui=UIHint(
                                            widget="text",
                                            label_key="settings.taskConfig.nanogpt.web.country",
                                            order=10,
                                        ),
                                    ),
                                    "city": FieldSpec(
                                        kind="string",
                                        ui=UIHint(
                                            widget="text",
                                            label_key="settings.taskConfig.nanogpt.web.city",
                                            order=20,
                                        ),
                                    ),
                                    "region": FieldSpec(
                                        kind="string",
                                        ui=UIHint(
                                            widget="text",
                                            label_key="settings.taskConfig.nanogpt.web.region",
                                            order=30,
                                        ),
                                    ),
                                },
                            ),
                        }),
                        "scraping": ObjectSpec(fields={
                            "scraping": FieldSpec(
                                kind="bool",
                                ui=UIHint(
                                    widget="toggle",
                                    label_key="settings.taskConfig.nanogpt.scraping",
                                    order=10,
                                ),
                            ),
                        }),
                        "youtube": ObjectSpec(fields={
                            "youtube_transcripts": FieldSpec(
                                kind="bool",
                                ui=UIHint(
                                    widget="toggle",
                                    label_key="settings.taskConfig.nanogpt.youtube",
                                    order=10,
                                ),
                            ),
                        }),
                        "memory": ObjectSpec(
                            group_toggle="enabled",
                            fields={
                            "enabled": FieldSpec(
                                kind="bool",
                                ui=UIHint(
                                    widget="toggle",
                                    label_key="settings.taskConfig.nanogpt.memory.enabled",
                                    order=10,
                                ),
                            ),
                            "expiration_days": FieldSpec(
                                kind="int",
                                min_value=1,
                                max_value=365,
                                ui=UIHint(
                                    label_key="settings.taskConfig.nanogpt.memory.expirationDays",
                                    help_key="settings.taskConfig.nanogpt.memory.expirationDaysHint",
                                    order=20,
                                ),
                            ),
                            "model_context_limit": FieldSpec(
                                kind="int",
                                min_value=1,
                                max_value=10000000,
                                ui=UIHint(
                                    label_key="settings.taskConfig.nanogpt.memory.modelContextLimit",
                                    help_key="settings.taskConfig.nanogpt.memory.modelContextLimitHint",
                                    order=30,
                                ),
                            ),
                        }),
                        "custom_fields": FieldSpec(
                            kind="object",
                            ui=UIHint(
                                widget="json",
                                label_key="settings.taskConfig.nanogpt.customFields",
                                help_key="settings.taskConfig.nanogpt.customFieldsHint",
                                order=999,
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
            ),
        },
        default_variant="default",
        supports_tools=True,
        supports_thinking=True,
    ),
    embedding=EmbeddingSpec(
        runtime=RuntimeSpec(adapter="default"),
        config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="nanogpt", expose=False),
            "model": FieldSpec(kind="string", default="", expose=False),
            "dimensions": FieldSpec(kind="int", default=None, expose=False),
        }),
    ),
    image=ImageSpec(
        runtime=RuntimeSpec(
            adapter="default",
            server_only={
                "fallback_aspect_ratios": ("1:1",),
                "fallback_resolutions": ("1024x1024",),
            },
        ),
        prompt_type="natural",
        supports_image_input=True,
        provider_settings=ObjectSpec(fields={
            "strength": FieldSpec(
                kind="number",
                min_value=0,
                max_value=1,
                ui=UIHint(
                    label_key="settings.imageGen.nanogptSettings.strength",
                    order=10,
                ),
            ),
            "guidance_scale": FieldSpec(
                kind="number",
                min_value=0,
                max_value=100,
                ui=UIHint(
                    label_key="settings.imageGen.nanogptSettings.guidanceScale",
                    order=20,
                ),
            ),
            "num_inference_steps": FieldSpec(
                kind="int",
                min_value=1,
                max_value=1000,
                ui=UIHint(
                    label_key="settings.imageGen.nanogptSettings.inferenceSteps",
                    order=30,
                ),
            ),
            "seed": FieldSpec(
                kind="int",
                min_value=0,
                ui=UIHint(
                    label_key="settings.imageGen.nanogptSettings.seed",
                    order=40,
                ),
            ),
            "kontext_max_mode": FieldSpec(
                kind="bool",
                when=(Condition(op="flag", flag="kontext_model"),),
                ui=UIHint(
                    widget="toggle",
                    label_key="settings.imageGen.nanogptSettings.kontextMaxMode",
                    order=50,
                ),
            ),
        }),
        models_adapter="dynamic",
    ),
)
