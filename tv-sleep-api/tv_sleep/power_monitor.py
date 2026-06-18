import os
import threading
import time

from .config import DEFAULT_SENSOR_DEVICE_ID
from .db import insert_event, insert_power_reading
from .power_meter import power_meter_status


POWER_SAMPLE_SECONDS = float(os.environ.get("DROWSEOFF_POWER_SAMPLE_SECONDS", "60"))
POWER_CONFIRM_DELAY_SECONDS = float(
    os.environ.get("DROWSEOFF_POWER_CONFIRM_DELAY_SECONDS", "20")
)

_sampler_started = False
_sampler_lock = threading.Lock()


def record_power_status(source="api", note=None, use_cache=False):
    status = power_meter_status(use_cache=use_cache)
    reading_id = insert_power_reading(status, source=source, note=note)
    return {**status, "reading_id": reading_id}


def power_meter_is_configured():
    return bool(power_meter_status(use_cache=True).get("configured"))


def _confirmation_note(status):
    watts = status.get("apower_w")
    threshold = status.get("on_threshold_w")

    if watts is None:
        return "TV OFF confirmation could not read wattage."

    return f"Power meter reports {watts} W; TV-on threshold is {threshold} W."


def _confirm_tv_off_after_delay(payload, device_id, source):
    time.sleep(max(0, POWER_CONFIRM_DELAY_SECONDS))
    status = record_power_status(
        source="confirmation",
        note=f"TV OFF confirmation after {source}",
        use_cache=False,
    )

    if not status.get("configured"):
        return

    if not status.get("ready"):
        event_type = "tv_off_power_unknown"
        note = status.get("last_probe_error") or "Power meter did not respond."
    elif status.get("tv_on") is True:
        event_type = "tv_off_power_still_on"
        note = _confirmation_note(status)
    else:
        event_type = "tv_off_power_confirmed"
        note = _confirmation_note(status)

    insert_event(
        {
            "device_id": device_id or payload.get("device_id") or DEFAULT_SENSOR_DEVICE_ID,
            "event_type": event_type,
            "sleep_score": payload.get("sleep_score"),
            "dist_filtered": payload.get("dist_filtered"),
            "note": note,
        }
    )


def schedule_tv_off_confirmation(payload, device_id=None, source="remote"):
    if POWER_CONFIRM_DELAY_SECONDS <= 0 or not power_meter_is_configured():
        return False

    thread = threading.Thread(
        target=_confirm_tv_off_after_delay,
        args=(dict(payload or {}), device_id, source),
        daemon=True,
    )
    thread.start()
    return True


def _power_sampler_loop():
    while True:
        time.sleep(max(1, POWER_SAMPLE_SECONDS))
        record_power_status(source="sampler", use_cache=False)


def start_power_sampler():
    global _sampler_started

    if POWER_SAMPLE_SECONDS <= 0:
        return False

    with _sampler_lock:
        if _sampler_started or not power_meter_is_configured():
            return False

        thread = threading.Thread(target=_power_sampler_loop, daemon=True)
        thread.start()
        _sampler_started = True
        return True
