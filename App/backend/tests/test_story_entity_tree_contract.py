from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


BACKEND_ROOT = ROOT / "App" / "backend"


def test_story_entity_tree_route_and_structure_patch_are_registered() -> None:
    tree_route_source = (BACKEND_ROOT / "routes" / "story_entity_tree_routes.py").read_text(
        encoding="utf-8",
    )
    unified_routes_source = (BACKEND_ROOT / "routes" / "unified_object_routes.py").read_text(
        encoding="utf-8",
    )
    main_source = (BACKEND_ROOT / "main.py").read_text(encoding="utf-8")

    assert '"/api/v1/projects/{project_id}/story-entity-tree"' in tree_route_source
    assert '"/objects/{object_type}/{object_id}/structure"' in unified_routes_source
    assert "story_entity_tree_router" in main_source
    assert "story_entity_folder_router" not in main_source
