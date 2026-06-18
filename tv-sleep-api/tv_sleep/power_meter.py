import json
import os
import time
from datetime import datetime
from urllib.error import URLError
from urllib.request import urlopen


POWER_METER_PROVIDER = os.environ.get("DROWSEOFF_POWER_METER_PROVIDER", "").strip().lower()
SHELLY_HOST = os.environ.get("SHELLY_HOST", "").strip()
SHELLY_SWITCH_ID = int(os.environ.get("SHELLY_SWITCH_ID", "0"))
SHELLY_TIMEOUT = float(os.environ.get("SHELLY_TIMEOUT", "5"))
SHELLY_ON_THRESHOLD_W = float(os.environ.get("SHELLY_ON_THRESHOLD_W", "30"))
SHELLY_STATUS_CACHE_SECONDS = float(os.environ.get("SHELLY_STATUS_CACHE_SECONDS", "5"))

_last_status_monotonic = 0.0
_last_status = None


class PowerMeterError(RuntimeError):
    pass


def provider_name():
    if POWER_METER_PROVIDER:
        return POWER_METER_PROVIDER
    if SHELLY_HOST:
        return "shelly"
    return "none"


def _now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _safe_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fetch_json(url):
    try:
        with urlopen(url, timeout=SHELLY_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, json.JSONDecodeError) as exc:
        raise PowerMeterError(str(exc)) from exc


def _shelly_status():
    if not SHELLY_HOST:
        raise PowerMeterError("Shelly host is not configured")

    url = f"http://{SHELLY_HOST}/rpc/Shelly.GetStatus"
    data = _fetch_json(url)
    component = data.get(f"switch:{SHELLY_SWITCH_ID}") or {}
    temperature = component.get("temperature") or {}
    apower_w = _safe_float(component.get("apower"))
    output = bool(component.get("output"))
    tv_on = bool(output and apower_w is not None and apower_w >= SHELLY_ON_THRESHOLD_W)

    return {
        "provider": "shelly",
        "host": SHELLY_HOST,
        "configured": True,
        "connected": True,
        "ready": True,
        "last_probe_at": _now_iso(),
        "last_probe_error": None,
        "switch_id": SHELLY_SWITCH_ID,
        "output": output,
        "apower_w": apower_w,
        "voltage_v": _safe_float(component.get("voltage")),
        "current_a": _safe_float(component.get("current")),
        "temperature_c": _safe_float(temperature.get("tC")),
        "on_threshold_w": SHELLY_ON_THRESHOLD_W,
        "tv_on": tv_on,
        "state": "on" if tv_on else "standby",
        "wifi_rssi": (data.get("wifi") or {}).get("rssi"),
    }


def power_meter_status(use_cache=True):
    global _last_status_monotonic
    global _last_status

    provider = provider_name()
    if provider == "none":
        return {
            "provider": provider,
            "host": "",
            "configured": False,
            "connected": False,
            "ready": False,
            "last_probe_at": None,
            "last_probe_error": None,
            "on_threshold_w": SHELLY_ON_THRESHOLD_W,
            "tv_on": None,
            "state": "unknown",
        }

    if provider != "shelly":
        return {
            "provider": provider,
            "host": "",
            "configured": False,
            "connected": False,
            "ready": False,
            "last_probe_at": None,
            "last_probe_error": f"Power meter provider '{provider}' is not supported",
            "on_threshold_w": SHELLY_ON_THRESHOLD_W,
            "tv_on": None,
            "state": "unknown",
        }

    if (
        use_cache
        and _last_status
        and time.monotonic() - _last_status_monotonic < SHELLY_STATUS_CACHE_SECONDS
    ):
        return _last_status

    try:
        status = _shelly_status()
    except PowerMeterError as exc:
        status = {
            "provider": "shelly",
            "host": SHELLY_HOST,
            "configured": bool(SHELLY_HOST),
            "connected": False,
            "ready": False,
            "last_probe_at": _now_iso(),
            "last_probe_error": str(exc),
            "on_threshold_w": SHELLY_ON_THRESHOLD_W,
            "tv_on": None,
            "state": "unknown",
        }

    _last_status = status
    _last_status_monotonic = time.monotonic()
    return status


def should_skip_tv_off():
    status = power_meter_status(use_cache=False)
    return status.get("ready") and status.get("tv_on") is False, status
