from __future__ import annotations

from ..shared.contracts import (
    Condition,
    FieldSpec,
    ImageModelDescriptor,
    ImageModelGeometrySpec,
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
    id="xai",
    ui=ProviderUI(
        display_name_key="settings.credentials.xai.title",
        icon_key="xai",
        description_key="settings.taskConfig.providerDescriptions.xai",
        llm_order=50,
        image_order=30,
    ),
    credentials=ObjectSpec(fields={
        "api_key": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="password",
                label_key="settings.credentials.apiKey",
                placeholder_key="settings.credentials.xai.placeholder",
                help_key="settings.credentials.getApiKeyFrom",
                link_url="https://console.x.ai",
                link_label="console.x.ai",
            ),
        ),
    }),
    llm=LLMSpec(
        common_task_config=ObjectSpec(fields={
            "provider": FieldSpec(kind="literal", const="xai", expose=False),
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
        supports_tools=False,
        supports_thinking=True,
    ),
    image=ImageSpec(
        runtime=RuntimeSpec(adapter="default"),
        prompt_type="natural",
        supports_image_input=False,
        catalog_cache_policy="static",
        models=(
            ImageModelDescriptor(
                id="grok-2-image",
                name="Grok 2 Image",
                prompt_type="natural",
                supports_image_input=False,
                geometry=ImageModelGeometrySpec(
                    supported_aspect_ratios=("1:1", "4:7", "7:4"),
                    supported_resolutions=("1K",),
                    default_aspect_ratio="1:1",
                    default_resolution="1K",
                    resolution_mode="translated_fixed",
                    native_size_by_ratio={"1:1": "1024x1024", "4:7": "1024x1792", "7:4": "1792x1024"},
                ),
            ),
            ImageModelDescriptor(
                id="grok-2-image-1212",
                name="Grok 2 Image 1212",
                prompt_type="natural",
                supports_image_input=False,
                geometry=ImageModelGeometrySpec(
                    supported_aspect_ratios=("1:1", "4:7", "7:4"),
                    supported_resolutions=("1K",),
                    default_aspect_ratio="1:1",
                    default_resolution="1K",
                    resolution_mode="translated_fixed",
                    native_size_by_ratio={"1:1": "1024x1024", "4:7": "1024x1792", "7:4": "1792x1024"},
                ),
            ),
        ),
    ),
)
