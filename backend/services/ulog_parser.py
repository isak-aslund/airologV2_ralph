"""ULog file metadata extraction service."""

import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from pyulog import ULog


def _parse_date_from_filename(filename: str) -> datetime | None:
    """
    Try to extract a date from a ULog filename.

    Common patterns:
    - log_X_YYYY-MM-DD-HH-MM-SS.ulg
    - YYYY-MM-DD_HH-MM-SS.ulg
    - YYYYMMDD_HHMMSS.ulg
    """
    # Pattern 1: log_X_YYYY-MM-DD-HH-MM-SS
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})", filename)
    if match:
        try:
            return datetime(
                int(match.group(1)),
                int(match.group(2)),
                int(match.group(3)),
                int(match.group(4)),
                int(match.group(5)),
                int(match.group(6)),
            )
        except ValueError:
            pass

    # Pattern 2: YYYY-MM-DD_HH-MM-SS
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})", filename)
    if match:
        try:
            return datetime(
                int(match.group(1)),
                int(match.group(2)),
                int(match.group(3)),
                int(match.group(4)),
                int(match.group(5)),
                int(match.group(6)),
            )
        except ValueError:
            pass

    # Pattern 3: YYYYMMDD_HHMMSS
    match = re.search(r"(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", filename)
    if match:
        try:
            return datetime(
                int(match.group(1)),
                int(match.group(2)),
                int(match.group(3)),
                int(match.group(4)),
                int(match.group(5)),
                int(match.group(6)),
            )
        except ValueError:
            pass

    return None


def extract_metadata(
    file_path: str | Path, original_filename: str | None = None
) -> dict[str, Any]:
    """
    Extract metadata from a .ulg file.

    Args:
        file_path: Path to the .ulg file
        original_filename: Original filename (used for date extraction fallback)

    Returns:
        Dictionary with:
        - duration_seconds: float or None
        - flight_date: datetime or None
        - serial_number: str or None (from AIROLIT_SERIAL param)
        - takeoff_lat: float or None
        - takeoff_lon: float or None
    """
    try:
        ulog = ULog(str(file_path))
    except Exception:
        return {
            "duration_seconds": None,
            "flight_date": None,
            "serial_number": None,
            "takeoff_lat": None,
            "takeoff_lon": None,
        }

    # Calculate duration from first to last timestamp
    duration_seconds: float | None = None
    try:
        start_ts = ulog.start_timestamp
        last_ts = ulog.last_timestamp
        if start_ts is not None and last_ts is not None:
            # Timestamps are in microseconds
            duration_seconds = (last_ts - start_ts) / 1_000_000.0
    except Exception:
        pass

    # Get flight date from start timestamp + time_ref_utc
    # Fall back to parsing original filename if time_ref_utc not available
    flight_date: datetime | None = None
    try:
        start_ts = ulog.start_timestamp
        time_ref_utc = ulog.msg_info_dict.get("time_ref_utc", 0)

        if time_ref_utc and time_ref_utc > 0 and start_ts is not None:
            # time_ref_utc is the UTC timestamp offset to add to boot-relative timestamps
            # Both are in microseconds
            absolute_time_us = start_ts + time_ref_utc
            flight_date = datetime.fromtimestamp(absolute_time_us / 1_000_000.0)
    except Exception:
        pass

    # Fallback: try to parse date from original filename
    if flight_date is None and original_filename:
        flight_date = _parse_date_from_filename(original_filename)

    # Get serial number from AIROLIT_SERIAL parameter
    serial_number: str | None = None
    try:
        params = ulog.initial_parameters
        if "AIROLIT_SERIAL" in params:
            serial_number = str(params["AIROLIT_SERIAL"])
    except Exception:
        pass

    # Get GPS coordinates from first valid GPS source
    # Try multiple sources: vehicle_gps_position, sensor_gps, vehicle_local_position.ref_*
    takeoff_lat: float | None = None
    takeoff_lon: float | None = None

    # Source 1: vehicle_gps_position (lat/lon in degrees * 1e7)
    try:
        gps_data = ulog.get_dataset("vehicle_gps_position")
        if gps_data is not None:
            lat_data = gps_data.data.get("lat")
            lon_data = gps_data.data.get("lon")

            if lat_data is not None and lon_data is not None and len(lat_data) > 0:
                for i in range(len(lat_data)):
                    lat_val = lat_data[i]
                    lon_val = lon_data[i]
                    if lat_val != 0 or lon_val != 0:
                        takeoff_lat = float(lat_val) / 1e7
                        takeoff_lon = float(lon_val) / 1e7
                        break
    except (KeyError, IndexError, ValueError, Exception):
        pass

    # Source 2: sensor_gps (if vehicle_gps_position not available)
    if takeoff_lat is None:
        try:
            gps_data = ulog.get_dataset("sensor_gps")
            if gps_data is not None:
                lat_data = gps_data.data.get("lat")
                lon_data = gps_data.data.get("lon")

                if lat_data is not None and lon_data is not None and len(lat_data) > 0:
                    for i in range(len(lat_data)):
                        lat_val = lat_data[i]
                        lon_val = lon_data[i]
                        if lat_val != 0 or lon_val != 0:
                            takeoff_lat = float(lat_val) / 1e7
                            takeoff_lon = float(lon_val) / 1e7
                            break
        except (KeyError, IndexError, ValueError, Exception):
            pass

    # Source 3: vehicle_local_position ref_lat/ref_lon (already in degrees, float)
    if takeoff_lat is None:
        try:
            for ds in ulog.data_list:
                if ds.name == "vehicle_local_position":
                    ref_lat = ds.data.get("ref_lat")
                    ref_lon = ds.data.get("ref_lon")
                    if ref_lat is not None and ref_lon is not None and len(ref_lat) > 0:
                        for i in range(len(ref_lat)):
                            lat_val = ref_lat[i]
                            lon_val = ref_lon[i]
                            # Skip nan and zero values
                            if not math.isnan(lat_val) and not math.isnan(lon_val):
                                if lat_val != 0.0 or lon_val != 0.0:
                                    takeoff_lat = float(lat_val)
                                    takeoff_lon = float(lon_val)
                                    break
                    break
        except (KeyError, IndexError, ValueError, Exception):
            pass

    return {
        "duration_seconds": duration_seconds,
        "flight_date": flight_date,
        "serial_number": serial_number,
        "takeoff_lat": takeoff_lat,
        "takeoff_lon": takeoff_lon,
    }


def get_parameters(file_path: str | Path) -> dict[str, Any]:
    """
    Get all parameters from a .ulg file.

    Args:
        file_path: Path to the .ulg file

    Returns:
        Dictionary of all parameters (key=param name, value=param value)
    """
    try:
        ulog = ULog(str(file_path))
        return dict(ulog.initial_parameters)
    except Exception:
        return {}
