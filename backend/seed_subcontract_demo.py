# @author: Wendy Yang
# @date: 2026-09-19

"""
Subcontracting demo seed — now folded into the master seed script.

Use:
    python backend/seed_db.py

That script creates the linked SO / PO / BOM / SCO / inventory story
(PROD-1001G + PROD-1010G → PROD-1020G via SCO-2026-0001).
"""

from seed_db import seed_data


if __name__ == "__main__":
    print("ℹ️  seed_subcontract_demo.py now delegates to seed_db.py")
    seed_data()
