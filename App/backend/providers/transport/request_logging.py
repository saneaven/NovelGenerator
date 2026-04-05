from __future__ import annotations

import copy
from typing import Any

from ...utils.outbound_http import merge_user_overrides


def build_logged_request_body(request: dict[str, Any] | None) -> dict[str, Any]:
    """Return a body-only representation for raw_request logging.

    Provider SDK kwargs may include transport-only fields such as `extra_headers`.
    Those must never be exposed in SSE/logging. `extra_body` is merged into the
    logged payload so the snapshot reflects the effective request body.
    """
    if not isinstance(request, dict):
        return {}

    body = copy.deepcopy(request)
    extra_body = body.pop("extra_body", None)

    # SDK transport / override channels are not part of the request body.
    body.pop("extra_headers", None)
    body.pop("extra_query", None)

    if isinstance(extra_body, dict) and extra_body:
        body = merge_user_overrides(body, copy.deepcopy(extra_body))

    return body
