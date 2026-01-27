"""ULog file metadata extraction service."""

import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from pyulog import ULog

# PX4 flight mode mapping from vehicle_status.nav_state
FLIGHT_MODES = {
    0: "Manual",
    1: "Altitude",
    2: "Position",
    3: "Mission",
    4: "Loiter",
    5: "Return to Land",
    10: "Acro",
    12: "Descend",
    14: "Offboard",
    15: "Stabilized",
    17: "Takeoff",
    18: "Land",
    19: "Follow Target",
    20: "Precision Land",
    21: "Orbit",
}


def extract_flight_modes(ulog: ULog) -> list[str]:
    """
    Extract unique flight modes from vehicle_status.nav_state.

    Args:
        ulog: Parsed ULog object

    Returns:
        Sorted list of unique human-readable flight mode names
    """
    modes: set[str] = set()

    try:
        for ds in ulog.data_list:
            if ds.name == "vehicle_status":
                nav_states = ds.data.get("nav_state")
                if nav_states is not None:
                    for state in nav_states:
                        mode_name = FLIGHT_MODES.get(int(state))
                        if mode_name:
                            modes.add(mode_name)
                break
    except Exception:
        pass

    return sorted(modes)


def _parse_date_from_filename(filename: str) -> datetime | None:
    """
    Try to extract a date from a ULog filename.

    Common patterns:
    - log_X_YYYY-MM-DD-HH-MM-SS.ulg (with 1 or 2 digit month/day/time)
    - YYYY-MM-DD_HH-MM-SS.ulg
    - YYYYMMDD_HHMMSS.ulg
    """
    # Pattern 1: log_X_YYYY-M-D-H-M-S (allows 1 or 2 digits for month/day/time)
    match = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})", filename)
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

    # Pattern 2: YYYY-MM-DD_HH-MM-SS (allows 1 or 2 digits for month/day/time)
    match = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})_(\d{1,2})-(\d{1,2})-(\d{1,2})", filename)
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

    # Pattern 3: YYYYMMDD_HHMMSS (strict 2 digits required for compact format)
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


def _get_log_identifier(filename: str | None) -> str | None:
    """
    Extract log identifier from filename.

    The log identifier is the filename without the .ulg extension.
    This provides a unique identifier per drone since filenames
    typically contain the log ID and timestamp from the drone.

    Args:
        filename: Original filename (e.g., "log_123_2024-01-15-10-30-00.ulg")

    Returns:
        Log identifier (e.g., "log_123_2024-01-15-10-30-00") or None
    """
    if not filename:
        return None
    # Remove .ulg extension (case-insensitive)
    if filename.lower().endswith(".ulg"):
        return filename[:-4]
    return filename


def extract_metadata(
    file_path: str | Path, original_filename: str | None = None
) -> dict[str, Any]:
    """
    Extract metadata from a .ulg file.

    Args:
        file_path: Path to the .ulg file
        original_filename: Original filename (used for date extraction fallback and log_identifier)

    Returns:
        Dictionary with:
        - duration_seconds: float or None
        - flight_date: datetime or None
        - serial_number: str or None (from AIROLIT_SERIAL param)
        - log_identifier: str or None (derived from original filename)
        - takeoff_lat: float or None
        - takeoff_lon: float or None
    """
    log_identifier = _get_log_identifier(original_filename)

    try:
        ulog = ULog(str(file_path))
    except Exception:
        return {
            "duration_seconds": None,
            "flight_date": None,
            "serial_number": None,
            "drone_model": None,
            "log_identifier": log_identifier,
            "takeoff_lat": None,
            "takeoff_lon": None,
            "flight_modes": [],
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

    # Get flight date from GPS UTC time or time_ref_utc
    # Priority: GPS time_utc_usec > time_ref_utc (if valid) > filename parsing
    flight_date: datetime | None = None

    # Minimum valid timestamp: year 2000 in microseconds (946684800 seconds)
    MIN_VALID_TIMESTAMP_US = 946684800 * 1_000_000

    # Source 1: Try GPS time_utc_usec field (most reliable)
    try:
        for ds in ulog.data_list:
            if ds.name in ("sensor_gps", "vehicle_gps_position"):
                if "time_utc_usec" in ds.data:
                    times = ds.data["time_utc_usec"]
                    # Find first valid (non-zero, reasonable) timestamp
                    for t in times:
                        if t > MIN_VALID_TIMESTAMP_US:
                            flight_date = datetime.fromtimestamp(t / 1_000_000.0)
                            break
                if flight_date:
                    break
    except Exception:
        pass

    # Source 2: Try time_ref_utc (only if it's a valid timestamp, not just seconds)
    if flight_date is None:
        try:
            time_ref_utc = ulog.msg_info_dict.get("time_ref_utc", 0)
            # Only use if it looks like a valid microsecond timestamp (after year 2000)
            if time_ref_utc and time_ref_utc > MIN_VALID_TIMESTAMP_US:
                flight_date = datetime.fromtimestamp(time_ref_utc / 1_000_000.0)
        except Exception:
            pass

    # Source 3: Fallback to parsing date from original filename
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

    # Get drone model from SYS_AUTOSTART parameter
    # Known mappings: S1 = 4010, CX10 = 4030, XLT = 4006
    # For unknown values, use the raw SYS_AUTOSTART value as the model
    drone_model: str | None = None
    try:
        params = ulog.initial_parameters
        if "SYS_AUTOSTART" in params:
            autostart = int(params["SYS_AUTOSTART"])
            autostart_to_model = {
                4010: "S1",
                4030: "CX10",
                4006: "XLT",
            }
            drone_model = autostart_to_model.get(autostart, str(autostart))
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

    # Extract flight modes from vehicle_status
    flight_modes = extract_flight_modes(ulog)

    return {
        "duration_seconds": duration_seconds,
        "flight_date": flight_date,
        "serial_number": serial_number,
        "drone_model": drone_model,
        "log_identifier": log_identifier,
        "takeoff_lat": takeoff_lat,
        "takeoff_lon": takeoff_lon,
        "flight_modes": flight_modes,
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
