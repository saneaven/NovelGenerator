from __future__ import annotations

from dataclasses import replace

from ..gemini.spec import SPEC as GEMINI_SPEC
from ..shared.contracts import FieldSpec, ObjectSpec, ProviderSpec, ProviderUI, UIHint


_gemini_llm = GEMINI_SPEC.llm
assert _gemini_llm is not None

SPEC = ProviderSpec(
    id="vertex",
    ui=ProviderUI(
        display_name_key="settings.credentials.vertex.title",
        icon_key="gemini",
        description_key="settings.taskConfig.providerDescriptions.vertex",
        llm_order=25,
        model_browser_grouping_llm="gemini_family",
    ),
    credentials=ObjectSpec(fields={
        "project_id": FieldSpec(
            kind="string",
            required=True,
            ui=UIHint(
                widget="text",
                label_key="settings.credentials.vertex.projectId",
                placeholder_key="settings.credentials.vertex.projectIdPlaceholder",
                order=10,
            ),
        ),
        "location": FieldSpec(
            kind="string",
            required=True,
            default="global",
            ui=UIHint(
                widget="text",
                label_key="settings.credentials.vertex.location",
                placeholder_key="settings.credentials.vertex.locationPlaceholder",
                order=20,
            ),
        ),
        "service_account_json": FieldSpec(
            kind="object",
            required=True,
            ui=UIHint(
                widget="json",
                label_key="settings.credentials.vertex.serviceAccountJson",
                placeholder_key="settings.credentials.vertex.serviceAccountJsonPlaceholder",
                order=30,
            ),
        ),
    }),
    llm=replace(
        _gemini_llm,
        common_task_config=replace(
            _gemini_llm.common_task_config,
            fields={
                **_gemini_llm.common_task_config.fields,
                "provider": FieldSpec(kind="literal", const="vertex", expose=False),
            },
        ),
    ),
)
