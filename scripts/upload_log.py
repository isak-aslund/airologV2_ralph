#!/usr/bin/env python3
"""
Upload script for programmatic flight log uploads.

Usage:
    python scripts/upload_log.py --file log.ulg --pilot "John Doe" --drone-model XLT [options]

Required arguments:
    --file         Path to the .ulg file to upload
    --pilot        Pilot name
    --drone-model  Drone model (XLT, S1, or CX10)

Optional arguments:
    --title        Log title (defaults to filename without extension)
    --comment      Optional comment
    --tags         Comma-separated list of tags
    --api-url      API base URL (defaults to http://localhost:8000)
"""

import argparse
import sys
from pathlib import Path

import requests


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Upload a .ulg flight log to the Flight Log Manager API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--file",
        required=True,
        type=str,
        help="Path to the .ulg file to upload",
    )
    parser.add_argument(
        "--pilot",
        required=True,
        type=str,
        help="Pilot name",
    )
    parser.add_argument(
        "--drone-model",
        required=True,
        type=str,
        choices=["XLT", "S1", "CX10"],
        help="Drone model (XLT, S1, or CX10)",
    )
    parser.add_argument(
        "--title",
        type=str,
        default=None,
        help="Log title (defaults to filename without extension)",
    )
    parser.add_argument(
        "--comment",
        type=str,
        default=None,
        help="Optional comment for the flight log",
    )
    parser.add_argument(
        "--tags",
        type=str,
        default=None,
        help="Comma-separated list of tags",
    )
    parser.add_argument(
        "--api-url",
        type=str,
        default="http://localhost:8000",
        help="API base URL (defaults to http://localhost:8000)",
    )

    return parser.parse_args()


def main() -> int:
    """Main entry point."""
    args = parse_args()

    # Validate file path
    file_path = Path(args.file)
    if not file_path.exists():
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        return 1

    if not file_path.suffix.lower() == ".ulg":
        print(f"Error: File must be a .ulg file: {file_path}", file=sys.stderr)
        return 1

    # Determine title
    title = args.title if args.title else file_path.stem

    # Build API URL
    api_url = args.api_url.rstrip("/")
    upload_url = f"{api_url}/api/logs"

    # Prepare form data
    form_data: dict[str, str] = {
        "title": title,
        "pilot": args.pilot,
        "drone_model": args.drone_model,
    }

    if args.comment:
        form_data["comment"] = args.comment

    if args.tags:
        form_data["tags"] = args.tags

    # Prepare file for upload
    try:
        with open(file_path, "rb") as f:
            files = {"file": (file_path.name, f, "application/octet-stream")}

            print(f"Uploading {file_path.name} to {upload_url}...")

            response = requests.post(
                upload_url,
                data=form_data,
                files=files,
                timeout=60,
            )

    except requests.exceptions.ConnectionError:
        print(f"Error: Could not connect to API at {api_url}", file=sys.stderr)
        return 1
    except requests.exceptions.Timeout:
        print("Error: Request timed out", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"Error: Could not read file: {e}", file=sys.stderr)
        return 1

    # Handle response
    if response.status_code == 201:
        result = response.json()
        log_id = result.get("id", "unknown")
        print(f"Success! Created flight log with ID: {log_id}")
        return 0
    else:
        error_detail = "Unknown error"
        try:
            error_json = response.json()
            error_detail = error_json.get("detail", str(error_json))
        except ValueError:
            error_detail = response.text or f"HTTP {response.status_code}"

        print(f"Error: Upload failed - {error_detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
