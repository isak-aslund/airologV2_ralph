"""ULog file metadata extraction service."""

from datetime import datetime
from pathlib import Path
from typing import Any

from pyulog import ULog


def extract_metadata(file_path: str | Path) -> dict[str, Any]:
    """
    Extract metadata from a .ulg file.

    Args:
        file_path: Path to the .ulg file

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

    # Get flight date from start timestamp
    flight_date: datetime | None = None
    try:
        start_ts = ulog.start_timestamp
        if start_ts is not None and start_ts > 0:
            # Start timestamp is in microseconds since epoch
            flight_date = datetime.fromtimestamp(start_ts / 1_000_000.0)
    except Exception:
        pass

    # Get serial number from AIROLIT_SERIAL parameter
    serial_number: str | None = None
    try:
        params = ulog.initial_parameters
        if "AIROLIT_SERIAL" in params:
            serial_number = str(params["AIROLIT_SERIAL"])
    except Exception:
        pass

    # Get GPS coordinates from first valid vehicle_gps_position message
    takeoff_lat: float | None = None
    takeoff_lon: float | None = None
    try:
        gps_data = ulog.get_dataset("vehicle_gps_position")
        if gps_data is not None:
            lat_data = gps_data.data.get("lat")
            lon_data = gps_data.data.get("lon")

            if lat_data is not None and lon_data is not None and len(lat_data) > 0:
                # GPS coordinates in ULog are stored as integers: degrees * 1e7
                # Find first valid (non-zero) position
                for i in range(len(lat_data)):
                    lat_val = lat_data[i]
                    lon_val = lon_data[i]
                    if lat_val != 0 or lon_val != 0:
                        takeoff_lat = float(lat_val) / 1e7
                        takeoff_lon = float(lon_val) / 1e7
                        break
    except (KeyError, IndexError, ValueError):
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
