"""Regenerate app/data/categories.json from the Apps Script seed list.

Source: finance-sheet/src/config/Defaults.gs at the repo root.

Run from expense-tracker/backend:  python scripts/export_categories.py
"""

import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEFAULTS = ROOT / "finance-sheet" / "src" / "config" / "Defaults.gs"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "categories.json"

# Parents that name Suraj's family members or farm. They stay in Suraj's household
# but are left out of the template that new, unrelated households get.
FAMILY_PARENTS = {"Gotu", "Mom", "Baba", "Pratiksha", "Farm"}


def parse_defaults(text: str) -> dict[str, dict[str, list[str]]]:
    blocks = {}
    for key in ("EXPENSE", "INCOME", "TRANSFER"):
        match = re.search(key + r":\s*(\{.*?\n  \})", text, re.S)
        if not match:
            raise ValueError(f"{key} block not found in Defaults.gs")
        blocks[key.lower()] = ast.literal_eval(match.group(1))
    return blocks


def stats_group(kind: str, parent: str, sub: str) -> str:
    if kind == "transfer":
        return "transfer"
    if kind == "income":
        return "repaid" if (parent, sub) == ("Friend", "Refund") else "earned"
    if parent == "Savings":
        return "saving"
    if (parent, sub) == ("Friend", "lent"):
        return "lent"
    return "spend"


def build() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    order = 0
    for kind, parents in parse_defaults(DEFAULTS.read_text()).items():
        for parent, subs in parents.items():
            for sub in subs:
                order += 1
                rows.append(
                    {
                        "kind": kind,
                        "parent_name": parent,
                        "sub_name": sub,
                        "stats_group": stats_group(kind, parent, sub),
                        "sort_order": order,
                        "family_only": parent in FAMILY_PARENTS,
                    }
                )
    return rows


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=1) + "\n")
    print(f"wrote {OUT}")
