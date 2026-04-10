#!/usr/bin/env python3
"""Fix drone_model for logs with non-standard SYS_AUTOSTART values.

Uses serial number prefix to determine the correct model:
  169250* -> 4006 (XLT)
  169251* -> 4010 (S1)
  169252* -> 4030 (CX10)

Talks to the API — no direct database access needed.

Usage:
  python scripts/fix_drone_models.py --server https://10.0.0.60
  python scripts/fix_drone_models.py --server https://10.0.0.60 --dry-run
"""

import argparse
import sys

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SERIAL_PREFIX_TO_MODEL = {
    "169250": "4006",  # XLT
    "169251": "4010",  # S1
    "169252": "4030",  # CX10
}

VALID_MODELS = {"4006", "4010", "4030"}


def get_all_logs(server: str) -> list[dict]:
    """Fetch all logs from the server."""
    logs = []
    page = 1
    while True:
        resp = requests.get(
            f"{server}/api/logs",
            params={"page": page, "page_size": 100},
            timeout=30,
            verify=False,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items", [])
        if not items:
            break
        logs.extend(items)
        if len(logs) >= data.get("total", 0):
            break
        page += 1
    return logs


def main():
    parser = argparse.ArgumentParser(description="Fix drone_model using serial number prefix")
    parser.add_argument("--server", required=True, help="API server URL")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without applying")
    args = parser.parse_args()

    server = args.server.rstrip("/")

    print(f"Fetching logs from {server}...")
    logs = get_all_logs(server)
    print(f"  {len(logs)} total logs")

    to_fix = []

    for log in logs:
        if log["drone_model"] in VALID_MODELS:
            continue

        serial = log.get("serial_number") or ""
        prefix = serial[:6]
        correct_model = SERIAL_PREFIX_TO_MODEL.get(prefix, "Unknown")
        to_fix.append((log, correct_model))

    print(f"  {len(to_fix)} to fix")

    if not to_fix:
        print("\nNothing to fix.")
        return

    if args.dry_run:
        print(f"\nDry run — would update {len(to_fix)} logs:")
        for log, new_model in to_fix[:20]:
            print(f"  {log['id'][:8]}.. serial={log.get('serial_number', '')} {log['drone_model']} -> {new_model}")
        if len(to_fix) > 20:
            print(f"  ... and {len(to_fix) - 20} more")
        return

    print(f"\nFixing {len(to_fix)} logs...")
    fixed = 0
    failed = 0

    for log, new_model in to_fix:
        try:
            resp = requests.put(
                f"{server}/api/logs/{log['id']}",
                json={"drone_model": new_model},
                timeout=30,
                verify=False,
            )
            resp.raise_for_status()
            fixed += 1
        except Exception as e:
            failed += 1
            print(f"  ERR {log['id'][:8]}.. : {e}")

    print(f"\nDone: {fixed} fixed, {failed} failed")


if __name__ == "__main__":
    main()
