#!/usr/bin/env python3
"""Migrate flight logs from old Django system to new FastAPI system.

Two-phase migration:
  1. scrape  — Scrape metadata and download .ulg files from old system
  2. upload  — Upload downloaded .ulg files to new system
  3. status  — Show migration progress summary

Dependencies: requests, beautifulsoup4, pyulog (all in project venv)

Usage:
  python scripts/migrate_old_logs.py scrape [options]
  python scripts/migrate_old_logs.py upload --target-server URL [options]
  python scripts/migrate_old_logs.py status [options]
"""

import argparse
import csv
import os
import re
import signal
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

# Add project root to path for backend imports
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CSV_FIELDS = [
    "old_id",
    "flight_date_raw",
    "pilot",
    "serial_old",
    "drone_model_old",
    "ulg_url",
    "comments",
    "filename",
    "local_path",
    "file_size",
    "scrape_status",
    "scrape_error",
    "upload_status",
    "upload_error",
    "new_id",
]

MODEL_NAME_TO_AUTOSTART = {
    "S1": "4010",
    "XLT": "4006",
    "CX10": "4030",
}

AUTOSTART_TO_TOW = {
    "4010": 1.56,
    "4006": 5.7,
    "4030": 4.2,
}

DEFAULT_SERIAL = "0000000001"
SERIAL_RE = re.compile(r"^\d{10}$")
DEFAULT_SERIAL_RE = re.compile(r"^16925\d0000$")

# ---------------------------------------------------------------------------
# Shutdown flag
# ---------------------------------------------------------------------------

_shutdown_requested = False


def _handle_signal(signum, frame):
    global _shutdown_requested
    if _shutdown_requested:
        print("\nForce quit.")
        sys.exit(1)
    _shutdown_requested = True
    print("\nShutdown requested — finishing current item and saving progress...")


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------


def load_manifest(path: Path) -> list[dict]:
    """Load the CSV manifest, returning a list of row dicts."""
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def save_manifest(path: Path, rows: list[dict]):
    """Atomically write the manifest CSV."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".csv.tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    tmp.replace(path)


# ---------------------------------------------------------------------------
# Serial validation
# ---------------------------------------------------------------------------


def is_valid_serial(serial: str | None) -> bool:
    if not serial:
        return False
    s = serial.strip()
    if not SERIAL_RE.match(s):
        return False
    if s == "0" or DEFAULT_SERIAL_RE.match(s):
        return False
    return True


# ---------------------------------------------------------------------------
# HTML scraping
# ---------------------------------------------------------------------------


def scrape_all_logs(old_server: str, page_size: int = 100) -> list[dict]:
    """Scrape all log entries from the old system's listing pages."""
    logs: list[dict] = []
    page = 1

    print(f"Scraping logs from {old_server} ...")

    while True:
        url = f"{old_server}/?page={page}&page_size={page_size}"
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table")
        if not table:
            break

        rows = table.find_all("tr")
        data_rows = rows[1:]  # skip header
        if not data_rows:
            break

        page_count = 0
        for row in data_rows:
            cells = row.find_all("td")
            if len(cells) < 12:
                continue
            entry = _parse_table_row(cells)
            if entry:
                logs.append(entry)
                page_count += 1

        print(f"  Page {page}: {page_count} logs (total so far: {len(logs)})")

        if page_count < page_size:
            break
        page += 1

    print(f"Scraping complete: {len(logs)} logs across {page} pages")
    return logs


def _parse_table_row(cells) -> dict | None:
    """Parse a table row into a dict.

    Columns: 0=Flight Date, 1=Pilot, 2=Serial, 3=Model, 4=Duration,
    5=Logs (ULG link), 6=Flight Review, 7=Plots, 8=Parameters,
    9=GPS, 10=Weather, 11=Comments, 12=Edit (old_id)
    """
    try:
        flight_date_raw = cells[0].get_text(strip=True)

        pilot_link = cells[1].find("a")
        pilot = (
            pilot_link.get_text(strip=True) if pilot_link else cells[1].get_text(strip=True)
        )

        serial_link = cells[2].find("a")
        serial = (
            serial_link.get_text(strip=True)
            if serial_link
            else cells[2].get_text(strip=True)
        )

        model_link = cells[3].find("a")
        drone_model = ""
        if model_link and model_link.get("href"):
            parts = model_link["href"].rstrip("/").split("/")
            drone_model = parts[-1] if parts else ""
        if not drone_model:
            drone_model = cells[3].get_text(strip=True)

        log_link = cells[5].find("a")
        ulg_url = log_link["href"] if log_link and log_link.get("href") else ""

        comments = cells[11].get_text(strip=True) if len(cells) > 11 else ""

        old_id = None
        if len(cells) > 12:
            edit_link = cells[12].find("a")
            if edit_link and edit_link.get("href"):
                match = re.search(r"/update_testflight/(\d+)", edit_link["href"])
                if match:
                    old_id = match.group(1)

        if old_id is None or not ulg_url:
            return None

        return {
            "old_id": old_id,
            "flight_date_raw": flight_date_raw,
            "pilot": pilot,
            "serial_old": serial,
            "drone_model_old": drone_model,
            "ulg_url": ulg_url,
            "comments": comments,
        }
    except (IndexError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# URL fixing
# ---------------------------------------------------------------------------


def fix_ulg_url(ulg_url: str, file_server: str) -> str:
    """Replace airolitserver.local hostname with file server IP."""
    parsed = urlparse(file_server)
    host = parsed.hostname
    port = parsed.port
    if port:
        url = re.sub(
            r"airolitserver\.local:\d+", f"{host}:{port}", ulg_url
        )
    else:
        url = ulg_url.replace("airolitserver.local", host)
    return url


# ---------------------------------------------------------------------------
# Scrape subcommand
# ---------------------------------------------------------------------------


def cmd_scrape(args):
    data_dir = Path(args.data_dir)
    manifest_path = data_dir / "migration_manifest.csv"
    ulg_dir = data_dir / "ulg_files"

    # Load existing manifest
    existing = load_manifest(manifest_path)
    existing_ids = {row["old_id"] for row in existing}

    # Scrape all entries from old system
    scraped = scrape_all_logs(args.old_server, page_size=args.page_size)

    # Merge: add new entries, keep existing ones unchanged
    new_count = 0
    for entry in scraped:
        if entry["old_id"] in existing_ids:
            continue

        ulg_url = fix_ulg_url(entry["ulg_url"], args.file_server)
        url_path = urlparse(ulg_url).path
        filename = Path(url_path).name
        if not filename.endswith(".ulg"):
            filename = f"{filename}.ulg"

        serial_dir = entry["serial_old"] if entry["serial_old"] else "unknown"
        local_path = f"ulg_files/{serial_dir}/{filename}"

        existing.append(
            {
                "old_id": entry["old_id"],
                "flight_date_raw": entry["flight_date_raw"],
                "pilot": entry["pilot"],
                "serial_old": entry["serial_old"],
                "drone_model_old": entry["drone_model_old"],
                "ulg_url": ulg_url,
                "comments": entry["comments"],
                "filename": filename,
                "local_path": local_path,
                "file_size": "",
                "scrape_status": "pending",
                "scrape_error": "",
                "upload_status": "pending",
                "upload_error": "",
                "new_id": "",
            }
        )
        existing_ids.add(entry["old_id"])
        new_count += 1

    # Sort by old_id ascending (oldest first)
    existing.sort(key=lambda r: int(r["old_id"]))

    print(f"\nManifest: {len(existing)} total entries ({new_count} new)")
    save_manifest(manifest_path, existing)

    # Download phase
    to_download = [
        r
        for r in existing
        if r["scrape_status"] == "pending"
        or (args.retry_failed and r["scrape_status"] == "failed")
    ]

    if not to_download:
        print("All files already downloaded.")
        return

    workers = args.workers
    print(f"Downloading {len(to_download)} files ({workers} workers)...\n")

    downloaded = 0
    failed = 0
    completed_count = 0
    total = len(to_download)
    manifest_lock = threading.Lock()

    def _download_one(row: dict) -> tuple[dict, str, int]:
        """Download a single file. Returns (row, status, size)."""
        dest = data_dir / row["local_path"]
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp_dest = dest.with_suffix(".ulg.tmp")

            resp = requests.get(row["ulg_url"], timeout=120, stream=True)
            resp.raise_for_status()

            size = 0
            with open(tmp_dest, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
                    size += len(chunk)

            tmp_dest.rename(dest)
            return (row, "ok", size)

        except Exception as e:
            tmp_path = dest.with_suffix(".ulg.tmp")
            if tmp_path.exists():
                tmp_path.unlink()
            return (row, str(e), 0)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {}
        for row in to_download:
            if _shutdown_requested:
                break
            fut = pool.submit(_download_one, row)
            futures[fut] = row

        for fut in as_completed(futures):
            if _shutdown_requested:
                pool.shutdown(wait=False, cancel_futures=True)
                break

            row, status, size = fut.result()
            completed_count += 1
            progress = f"[{completed_count}/{total}]"

            if status == "ok":
                row["scrape_status"] = "downloaded"
                row["file_size"] = str(size)
                row["scrape_error"] = ""
                downloaded += 1
                print(f"  {progress} OK  #{row['old_id']} {row['filename']} ({_fmt_size(size)})")
            else:
                row["scrape_status"] = "failed"
                row["scrape_error"] = status
                failed += 1
                print(f"  {progress} ERR #{row['old_id']} {row['filename']}: {status}")

            if completed_count % args.batch_size == 0:
                with manifest_lock:
                    save_manifest(manifest_path, existing)

    # Final save
    save_manifest(manifest_path, existing)

    already = sum(1 for r in existing if r["scrape_status"] == "downloaded") - downloaded
    print(f"\n--- Scrape Summary ---")
    print(f"  Downloaded:      {downloaded}")
    print(f"  Failed:          {failed}")
    print(f"  Already done:    {already}")
    if _shutdown_requested:
        print(f"\nPaused. Re-run to continue.")


# ---------------------------------------------------------------------------
# Upload subcommand
# ---------------------------------------------------------------------------


def cmd_upload(args):
    from backend.services.ulog_parser import extract_metadata

    data_dir = Path(args.data_dir)
    manifest_path = data_dir / "migration_manifest.csv"

    rows = load_manifest(manifest_path)
    if not rows:
        print(f"No manifest found at {manifest_path}. Run 'scrape' first.")
        return

    # Filter candidates
    candidates = [
        r
        for r in rows
        if r["scrape_status"] == "downloaded"
        and (
            r["upload_status"] in ("pending", "")
            or (args.retry_failed and r["upload_status"] == "failed")
        )
    ]

    if not candidates:
        print("Nothing to upload — all downloaded logs already processed.")
        return

    if args.dry_run:
        print(f"Dry run: {len(candidates)} logs would be uploaded to {args.target_server}\n")
        for entry in candidates[:20]:
            print(f"  #{entry['old_id']} {entry['filename']} ({entry['pilot']}, {entry['drone_model_old']})")
        if len(candidates) > 20:
            print(f"  ... and {len(candidates) - 20} more")
        return

    workers = args.workers
    print(f"Uploading {len(candidates)} logs to {args.target_server} ({workers} workers)\n")

    uploaded = 0
    duplicates = 0
    failed = 0
    completed_count = 0
    total = len(candidates)
    manifest_lock = threading.Lock()

    def _upload_one(row: dict) -> tuple[dict, str, str]:
        """Upload a single file. Returns (row, status, detail)."""
        file_path = data_dir / row["local_path"]

        if not file_path.exists():
            return (row, "missing", "File not found locally")

        try:
            metadata = extract_metadata(str(file_path), original_filename=row["filename"])

            drone_model = _determine_drone_model(
                metadata.get("drone_model"), row["drone_model_old"]
            )
            serial = _determine_serial(
                metadata.get("serial_number"), row["serial_old"]
            )
            tow = AUTOSTART_TO_TOW.get(drone_model)
            title = row["filename"].removesuffix(".ulg")

            form_data = {
                "title": title,
                "pilot": row["pilot"],
                "drone_model": drone_model,
                "serial_number": serial,
                "tags": "migrated",
            }
            if row["comments"]:
                form_data["comment"] = row["comments"]
            if tow is not None:
                form_data["tow"] = str(tow)

            with open(file_path, "rb") as f:
                files = {"file": (row["filename"], f, "application/octet-stream")}
                resp = requests.post(
                    f"{args.target_server}/api/logs",
                    data=form_data,
                    files=files,
                    timeout=120,
                )

            if resp.status_code == 201:
                new_id = resp.json().get("id", "")
                return (row, "uploaded", new_id)
            elif resp.status_code == 409:
                return (row, "duplicate", "")
            else:
                detail = ""
                try:
                    detail = resp.json().get("detail", resp.text)
                except Exception:
                    detail = resp.text or f"HTTP {resp.status_code}"
                return (row, "failed", str(detail)[:200])

        except Exception as e:
            return (row, "failed", str(e)[:200])

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {}
        for row in candidates:
            if _shutdown_requested:
                break
            fut = pool.submit(_upload_one, row)
            futures[fut] = row

        for fut in as_completed(futures):
            if _shutdown_requested:
                pool.shutdown(wait=False, cancel_futures=True)
                break

            row, status, detail = fut.result()
            completed_count += 1
            progress = f"[{completed_count}/{total}]"

            if status == "uploaded":
                row["upload_status"] = "uploaded"
                row["upload_error"] = ""
                row["new_id"] = detail
                uploaded += 1
                print(f"  {progress} OK  #{row['old_id']} {row['filename']}")
            elif status == "duplicate":
                row["upload_status"] = "duplicate"
                row["upload_error"] = ""
                duplicates += 1
                print(f"  {progress} DUP #{row['old_id']} {row['filename']}")
            elif status == "missing":
                row["upload_status"] = "failed"
                row["upload_error"] = detail
                failed += 1
                print(f"  {progress} MISS #{row['old_id']} {row['filename']}")
            else:
                row["upload_status"] = "failed"
                row["upload_error"] = detail
                failed += 1
                print(f"  {progress} ERR #{row['old_id']} {row['filename']}: {detail}")

            if completed_count % args.batch_size == 0:
                with manifest_lock:
                    save_manifest(manifest_path, rows)

    save_manifest(manifest_path, rows)

    print(f"\n--- Upload Summary ---")
    print(f"  Uploaded:        {uploaded}")
    print(f"  Duplicates:      {duplicates}")
    print(f"  Failed:          {failed}")
    if _shutdown_requested:
        print(f"\nPaused. Re-run to continue.")


def _determine_drone_model(extracted: str | None, old_model: str) -> str:
    if extracted:
        return extracted
    mapped = MODEL_NAME_TO_AUTOSTART.get(old_model)
    if mapped:
        return mapped
    return old_model


def _determine_serial(extracted: str | None, old_serial: str) -> str:
    if is_valid_serial(extracted):
        return extracted.strip()
    if is_valid_serial(old_serial):
        return old_serial.strip()
    return DEFAULT_SERIAL


# ---------------------------------------------------------------------------
# Status subcommand
# ---------------------------------------------------------------------------


def cmd_status(args):
    data_dir = Path(args.data_dir)
    manifest_path = data_dir / "migration_manifest.csv"

    rows = load_manifest(manifest_path)
    if not rows:
        print(f"No manifest found at {manifest_path}. Run 'scrape' first.")
        return

    # Scrape stats
    s_downloaded = sum(1 for r in rows if r["scrape_status"] == "downloaded")
    s_failed = sum(1 for r in rows if r["scrape_status"] == "failed")
    s_pending = sum(1 for r in rows if r["scrape_status"] == "pending")
    total_bytes = sum(int(r["file_size"]) for r in rows if r["file_size"])

    # Upload stats
    u_uploaded = sum(1 for r in rows if r["upload_status"] == "uploaded")
    u_duplicate = sum(1 for r in rows if r["upload_status"] == "duplicate")
    u_failed = sum(1 for r in rows if r["upload_status"] == "failed")
    u_pending = sum(
        1
        for r in rows
        if r["scrape_status"] == "downloaded"
        and r["upload_status"] in ("pending", "")
    )

    print(f"Migration Status ({manifest_path})")
    print("=" * 55)
    print(f"Total entries:      {len(rows)}")
    print()
    print(f"Scrape:")
    print(f"  Downloaded:       {s_downloaded}")
    print(f"  Failed:           {s_failed}")
    print(f"  Pending:          {s_pending}")
    print(f"  Disk usage:       {_fmt_size(total_bytes)}")
    print()
    print(f"Upload:")
    print(f"  Uploaded:         {u_uploaded}")
    print(f"  Duplicates:       {u_duplicate}")
    print(f"  Failed:           {u_failed}")
    print(f"  Pending:          {u_pending}")

    if args.show_failed:
        failed_scrape = [r for r in rows if r["scrape_status"] == "failed"]
        failed_upload = [r for r in rows if r["upload_status"] == "failed"]

        if failed_scrape:
            print(f"\nFailed downloads:")
            for r in failed_scrape:
                print(f"  #{r['old_id']} {r['filename']}: {r['scrape_error']}")

        if failed_upload:
            print(f"\nFailed uploads:")
            for r in failed_upload:
                print(f"  #{r['old_id']} {r['filename']}: {r['upload_error']}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fmt_size(nbytes: int) -> str:
    if nbytes < 1024:
        return f"{nbytes} B"
    elif nbytes < 1024 * 1024:
        return f"{nbytes / 1024:.1f} KB"
    elif nbytes < 1024 * 1024 * 1024:
        return f"{nbytes / (1024 * 1024):.1f} MB"
    else:
        return f"{nbytes / (1024 * 1024 * 1024):.2f} GB"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Migrate flight logs from old Django system to new FastAPI system.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # --- scrape ---
    p_scrape = sub.add_parser("scrape", help="Scrape metadata and download .ulg files")
    p_scrape.add_argument(
        "--old-server",
        default="http://10.0.0.100:8000",
        help="Old system URL (default: http://10.0.0.100:8000)",
    )
    p_scrape.add_argument(
        "--file-server",
        default="http://10.0.0.100:8888",
        help="ULG file server URL (default: http://10.0.0.100:8888)",
    )
    p_scrape.add_argument(
        "--data-dir",
        default="data/migration",
        help="Directory for manifest and downloads (default: data/migration)",
    )
    p_scrape.add_argument(
        "--batch-size",
        type=int,
        default=10,
        help="Save manifest every N downloads (default: 10)",
    )
    p_scrape.add_argument(
        "--retry-failed",
        action="store_true",
        help="Re-attempt previously failed downloads",
    )
    p_scrape.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="Rows per page when scraping (default: 100)",
    )
    p_scrape.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Parallel download threads (default: 6)",
    )

    # --- upload ---
    p_upload = sub.add_parser("upload", help="Upload downloaded .ulg files to new system")
    p_upload.add_argument(
        "--target-server",
        required=True,
        help="Target API server URL (e.g., http://localhost:8000)",
    )
    p_upload.add_argument(
        "--data-dir",
        default="data/migration",
        help="Directory containing manifest and downloads (default: data/migration)",
    )
    p_upload.add_argument(
        "--batch-size",
        type=int,
        default=10,
        help="Save manifest every N uploads (default: 10)",
    )
    p_upload.add_argument(
        "--retry-failed",
        action="store_true",
        help="Re-attempt previously failed uploads",
    )
    p_upload.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be uploaded without doing it",
    )
    p_upload.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Parallel upload threads (default: 4)",
    )

    # --- status ---
    p_status = sub.add_parser("status", help="Show migration progress")
    p_status.add_argument(
        "--data-dir",
        default="data/migration",
        help="Directory containing manifest (default: data/migration)",
    )
    p_status.add_argument(
        "--show-failed",
        action="store_true",
        help="List individual failed entries",
    )

    return parser


def main():
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    parser = build_parser()
    args = parser.parse_args()

    if args.command == "scrape":
        cmd_scrape(args)
    elif args.command == "upload":
        cmd_upload(args)
    elif args.command == "status":
        cmd_status(args)


if __name__ == "__main__":
    main()
