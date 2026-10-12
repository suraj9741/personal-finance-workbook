"""Write config/seed.yaml from the finance sheet's starter list (finance-sheet Defaults.gs).

seed.yaml is the file you edit. Run this only to start it over from the sheet:

    cd expense-tracker/backend && uv run python scripts/config_from_sheet.py > ../config/seed.yaml
"""

import ast
import re
import sys
from pathlib import Path

DEFAULTS = (
    Path(__file__).resolve().parent.parent.parent.parent / "finance-sheet/src/config/Defaults.gs"
)

PAY_TYPES = {
    "Bank": "bank",
    "Credit Card": "credit_card",
    "Share Broker": "share_broker",
    "Cash": "cash",
}
# Where a category doesn't count as plain spend/income. Everything else uses the default
# for its kind: expense -> spend, income -> earned, transfer -> transfer.
PARENT_GROUPS = {("expense", "Savings"): "saving"}
SUB_GROUPS = {("expense", "Friend", "lent"): "lent", ("income", "Friend", "Refund"): "repaid"}
# Groups only your own household gets. Invited households get everything else.
FAMILY = {"Gotu", "Mom", "Baba", "Pratiksha", "Farm"}

HEADER = """\
# What the app adds at deploy time (`make up` runs the seed step after migrations).
#
# The seed only ADDS what is missing. It never renames, changes or deletes anything, so
# edits you make in the app are safe. Something you delete in the app is not added back:
# the app remembers what it has already seeded.
#
# Categories: group -> list of categories. A group or a category that is not plain spend
# (or plain income) says what it counts as: saving, lent, repaid. Example:
#   Savings: {counts_as: saving, items: [PPF, Gold]}
#   Friend: [EMI, {name: lent, counts_as: lent}]
"""


def q(value: str) -> str:
    """Quote only when YAML would misread the bare string."""
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9 ./&'-]*", value) and value.lower() not in {
        "yes",
        "no",
        "on",
        "off",
        "true",
        "false",
        "null",
    }:
        return value
    return '"' + value.replace('"', '\\"') + '"'


def item(kind: str, parent: str, sub: str) -> str:
    group = SUB_GROUPS.get((kind, parent, sub))
    return f"{{name: {q(sub)}, counts_as: {group}}}" if group else q(sub)


def categories(
    blocks: list[tuple[str, dict[str, list[str]]]], indent: str, skip: set[str] | None = None
) -> list[str]:
    lines = []
    for kind, parents in blocks:
        lines.append(f"{indent}{kind}:")
        for parent, subs in parents.items():
            if skip and parent in skip:
                continue
            items = ", ".join(item(kind, parent, s) for s in subs)
            group = PARENT_GROUPS.get((kind, parent))
            if group:
                lines.append(f"{indent}  {q(parent)}: {{counts_as: {group}, items: [{items}]}}")
            else:
                lines.append(f"{indent}  {q(parent)}: [{items}]")
    return lines


def render(text: str) -> str:
    lines = [HEADER, "settings:", '  currency_symbol: "₹"', '  invite_expiry_days: "7"', ""]
    lines += ["# Every household that has a site admin (yours).", "admin_household:", "  accounts:"]
    pay = re.search(r"PAY:\s*(\[.*?\n  \])", text, re.S)
    if not pay:
        raise ValueError("PAY block not found in Defaults.gs")
    by_type: dict[str, list[str]] = {}
    for pay_type, name, _opening in ast.literal_eval(pay.group(1)):
        by_type.setdefault(PAY_TYPES[pay_type], []).append(q(name))
    for pay_type, names in by_type.items():
        lines.append(f"    {pay_type}: [{', '.join(names)}]")
    lines.append("  categories:")
    blocks = []
    for key in ("EXPENSE", "INCOME", "TRANSFER"):
        block = re.search(key + r":\s*(\{.*?\n  \})", text, re.S)
        if not block:
            raise ValueError(f"{key} block not found in Defaults.gs")
        blocks.append((key.lower(), ast.literal_eval(block.group(1))))
    lines += categories(blocks, "    ")
    lines += [
        "",
        "# Households created from an invite start with no accounts and get these categories",
        "# (the list above without the family groups). Empty it ({}) to give new people",
        "# nothing. You can also edit it on the Admin page.",
        "new_household:",
        "  categories:",
    ]
    lines += categories(blocks, "    ", skip=FAMILY)
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    sys.stdout.write(render(DEFAULTS.read_text()))
