from __future__ import annotations

from uuid import uuid4

from App.backend.services.rich_text.markdown_parser import markdown_to_tree
from App.backend.services.rich_text.markdown_renderer import tree_to_markdown
from App.backend.services.rich_text.tiptap_adapter import tiptap_to_tree, tree_to_tiptap


def test_markdown_image_uses_asset_id_alt_and_asset_name_title() -> None:
    asset_id = str(uuid4())
    tree = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "image",
                        "attrs": {
                            "src": f"/storage/assets/originals/{asset_id}.avif",
                            "assetId": asset_id,
                            "alt": "old prompt",
                        },
                    }
                ],
            }
        ],
    }

    markdown = tree_to_markdown(
        tree,
        image_titles_by_asset_id={asset_id: 'Name "quoted" [draft]\nsecond'},
    )

    assert markdown == (
        f'![{asset_id}](/storage/assets/originals/{asset_id}.avif '
        '"Name \\"quoted\\" [draft]\\nsecond")'
    )


def test_markdown_parser_reads_asset_id_from_alt_not_src() -> None:
    asset_id = str(uuid4())
    other_id = str(uuid4())

    parsed = markdown_to_tree(
        f'![{asset_id}](/storage/assets/originals/{other_id}.avif "Asset Name")'
    )

    attrs = parsed["content"][0]["content"][0]["attrs"]
    assert attrs["assetId"] == asset_id
    assert attrs["alt"] == asset_id
    assert attrs["title"] == "Asset Name"
    assert attrs["src"] == f"/storage/assets/originals/{other_id}.avif"


def test_markdown_parser_does_not_recover_asset_id_from_src() -> None:
    asset_id = str(uuid4())

    parsed = markdown_to_tree(
        f'![not-an-asset-id](/storage/assets/originals/{asset_id}.avif "Asset Name")'
    )

    attrs = parsed["content"][0]["content"][0]["attrs"]
    assert attrs["alt"] == "not-an-asset-id"
    assert attrs["title"] == "Asset Name"
    assert "assetId" not in attrs


def test_tiptap_image_title_round_trips() -> None:
    asset_id = str(uuid4())
    tiptap = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "image",
                        "attrs": {
                            "src": f"/storage/assets/originals/{asset_id}.avif",
                            "alt": asset_id,
                            "title": "Asset Name",
                            "data-asset-id": asset_id,
                        },
                    }
                ],
            }
        ],
    }

    tree = tiptap_to_tree(tiptap)
    attrs = tree["content"][0]["content"][0]["attrs"]
    assert attrs["assetId"] == asset_id
    assert attrs["title"] == "Asset Name"

    round_trip = tree_to_tiptap(tree)
    round_trip_attrs = round_trip["content"][0]["content"][0]["attrs"]
    assert round_trip_attrs["data-asset-id"] == asset_id
    assert round_trip_attrs["title"] == "Asset Name"
