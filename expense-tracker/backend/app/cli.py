"""Command-line tasks: create the first admin, load demo data.

python -m app.cli create-admin --email you@example.com [--name "Suraj"]
python -m app.cli seed-demo
"""

import argparse
import getpass
import random
import sys
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.models import Account, Category, HouseholdMember, Transaction, User
from app.security import hash_password
from app.services import add_months, create_household

MIN_PASSWORD = 10


def create_admin(db: Session, email: str, name: str, password: str) -> User:
    """Site admin with their own household holding the full Defaults.gs category list."""
    email = email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise SystemExit(f"A user with email {email} already exists")
    user = User(
        email=email, display_name=name, password_hash=hash_password(password), is_site_admin=True
    )
    db.add(user)
    db.flush()
    household = create_household(db, f"{name}'s household", full_seed=True)
    db.add(HouseholdMember(household_id=household.id, user_id=user.id, role="owner"))
    db.commit()
    return user


def prompt_password() -> str:
    first = getpass.getpass("Password (min 10 characters): ")
    if len(first) < MIN_PASSWORD:
        raise SystemExit("Password too short")
    if getpass.getpass("Repeat password: ") != first:
        raise SystemExit("Passwords don't match")
    return first


def seed_demo(db: Session) -> None:
    """Two fake households so you can try the app. Never your real numbers."""
    if db.scalar(select(User).where(User.email == "asha@example.com")):
        print("Demo data already present")
        return
    password = "demo-password"
    family = create_household(db, "Demo family")
    solo = create_household(db, "Demo solo")
    people = [
        ("asha@example.com", "Asha", family.id, "owner"),
        ("ravi@example.com", "Ravi", family.id, "member"),
        ("sam@example.com", "Sam", solo.id, "owner"),
    ]
    users = {}
    for email, name, household_id, role in people:
        user = User(email=email, display_name=name, password_hash=hash_password(password))
        db.add(user)
        db.flush()
        db.add(HouseholdMember(household_id=household_id, user_id=user.id, role=role))
        users[name] = user
    db.flush()

    rng = random.Random(42)
    for household_id, author in ((family.id, users["Asha"]), (solo.id, users["Sam"])):
        cats = {
            (c.parent_name, c.sub_name): c
            for c in db.scalars(select(Category).where(Category.household_id == household_id))
        }
        accounts = {
            a.name: a
            for a in db.scalars(select(Account).where(Account.household_id == household_id))
        }
        bank, card, cash = accounts["HDFC"], accounts["Yes Bank"], accounts["Cash"]
        first = add_months(date.today().replace(day=1), -2)
        for m in range(3):
            month = add_months(first, m)
            entries = [
                (1, "117000", "income", ("Wages", "Paycheck"), bank, None, "Salary"),
                (2, "8500", "expense", ("Room", "Rent/mortgage"), bank, None, "Rent"),
                (5, "15450", "expense", ("Debt", "Car EMI"), bank, None, "Car EMI"),
                (10, "2000", "expense", ("Savings", "PPF"), bank, None, "PPF"),
                (
                    18,
                    "21000",
                    "transfer",
                    ("Self Transfer", "Bank to Credit"),
                    bank,
                    card,
                    "Card bill",
                ),
            ]
            for _ in range(12):
                entries.append(
                    (
                        rng.randint(1, 27),
                        str(rng.randint(80, 900)),
                        "expense",
                        rng.choice(
                            [
                                ("Everyday", "Food"),
                                ("Everyday", "Groceries"),
                                ("Transportation", "Fuel"),
                            ]
                        ),
                        rng.choice([card, cash]),
                        None,
                        rng.choice(["Swiggy", "DMart", "Petrol", "Zomato"]),
                    )
                )
            for day, amount, kind, cat, account, to_account, desc in entries:
                db.add(
                    Transaction(
                        household_id=household_id,
                        date=month + timedelta(days=day - 1),
                        amount=Decimal(amount),
                        type=kind,
                        account_id=account.id,
                        to_account_id=to_account.id if to_account else None,
                        category_id=cats[cat].id,
                        description=desc,
                        created_by=author.id,
                    )
                )
        db.add(
            Transaction(
                household_id=household_id,
                date=first + timedelta(days=3),
                amount=Decimal("5000"),
                type="expense",
                account_id=bank.id,
                category_id=cats[("Friend", "lent")].id,
                description="Loan to friend",
                counterparty="Neel",
                created_by=author.id,
            )
        )
    db.commit()
    print(
        "Demo users (password 'demo-password'): asha@example.com (family owner), "
        "ravi@example.com (family member), sam@example.com (solo)"
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("create-admin")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", default=None)
    sub.add_parser("seed-demo")
    args = parser.parse_args(argv)
    with get_sessionmaker()() as db:
        if args.command == "create-admin":
            name = args.name or args.email.split("@")[0].title()
            create_admin(db, args.email, name, prompt_password())
            print(f'Admin {args.email} created with household "{name}\'s household"')
        else:
            seed_demo(db)


if __name__ == "__main__":
    main(sys.argv[1:])
