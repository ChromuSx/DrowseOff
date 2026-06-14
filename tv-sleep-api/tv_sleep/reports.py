from .db import as_int, get_last_power_event, get_readings, get_readings_between, get_settings
from .time_utils import current_night_window, parse_iso_datetime


def estimated_seconds(rows, predicate):
    total = 0

    for index, row in enumerate(rows):
        if not predicate(row):
            continue

        current = parse_iso_datetime(row.get("ts"))
        next_dt = None

        if index + 1 < len(rows):
            next_dt = parse_iso_datetime(rows[index + 1].get("ts"))

        if current and next_dt:
            delta = (next_dt - current).total_seconds()
            total += max(0, min(int(delta), 60))
        else:
            total += 10

    return total


def last_value(rows, field):
    for row in reversed(rows):
        value = row.get(field)
        if value not in (None, ""):
            return value
    return None


def percentile(values, percent):
    if not values:
        return None

    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]

    position = (len(ordered) - 1) * (percent / 100)
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction)


def get_night_report():
    start, end = current_night_window()
    rows = get_readings_between(start, end)
    first_in_bed = next((row for row in rows if row.get("in_bed")), None)
    max_sleep_score = max([as_int(row.get("sleep_score")) or 0 for row in rows] or [0])
    tv_commands = sum(1 for row in rows if row.get("tv_command_sent"))
    out_of_bed_readings = sum(
        1 for row in rows if row.get("presence") and not row.get("in_bed")
    )

    mode = last_value(rows, "mode")
    threshold = last_value(rows, "threshold")

    return {
        "window_start": start.isoformat(timespec="seconds"),
        "window_end": end.isoformat(timespec="seconds"),
        "readings": len(rows),
        "first_in_bed_ts": first_in_bed.get("ts") if first_in_bed else None,
        "last_ts": rows[-1].get("ts") if rows else None,
        "max_sleep_score": max_sleep_score,
        "mode": mode,
        "threshold": threshold,
        "tv_commands": tv_commands,
        "out_of_bed_readings": out_of_bed_readings,
        "in_bed_seconds": estimated_seconds(
            rows, lambda row: bool(row.get("in_bed"))
        ),
        "stable_seconds": estimated_seconds(
            rows, lambda row: bool(row.get("in_bed")) and bool(row.get("stable"))
        ),
        "last_power_event": get_last_power_event(),
        "night_power_event": get_last_power_event(start, end),
    }


def get_morning_report():
    night = get_night_report()
    power_event = night.get("night_power_event")

    if night["readings"] == 0:
        summary = "Non ci sono ancora letture nella finestra notte."
    elif power_event:
        summary = f"TV comandata alle {power_event['ts']} con punteggio {power_event.get('sleep_score', '-') }."
    else:
        summary = (
            "Nessun comando TV registrato nella notte. "
            f"Punteggio massimo: {night['max_sleep_score']}."
        )

    return {
        "summary": summary,
        "readings": night["readings"],
        "window_start": night["window_start"],
        "window_end": night["window_end"],
        "first_in_bed_ts": night["first_in_bed_ts"],
        "last_ts": night["last_ts"],
        "max_sleep_score": night["max_sleep_score"],
        "threshold": night["threshold"],
        "in_bed_seconds": night["in_bed_seconds"],
        "stable_seconds": night["stable_seconds"],
        "out_of_bed_readings": night["out_of_bed_readings"],
        "tv_commands": night["tv_commands"],
        "night_power_event": power_event,
    }


def get_calibration_report(limit=500):
    settings = get_settings()
    rows = list(reversed(get_readings(limit)))
    distances = [
        as_int(row.get("dist_filtered"))
        for row in rows
        if row.get("in_bed") and as_int(row.get("dist_filtered")) is not None
    ]
    distances = [value for value in distances if value and value > 0]
    stable_rows = [row for row in rows if row.get("in_bed") and row.get("stable")]
    in_bed_rows = [row for row in rows if row.get("in_bed")]

    p10 = percentile(distances, 10)
    p50 = percentile(distances, 50)
    p90 = percentile(distances, 90)

    if p10 is not None and p90 is not None:
        suggested_min = max(20, p10 - 10)
        suggested_max = min(600, p90 + 10)
    else:
        suggested_min = settings["distance_min_cm"]
        suggested_max = settings["distance_max_cm"]

    return {
        "samples": len(rows),
        "in_bed_samples": len(in_bed_rows),
        "stable_samples": len(stable_rows),
        "distance_samples": len(distances),
        "current_min_cm": settings["distance_min_cm"],
        "current_max_cm": settings["distance_max_cm"],
        "suggested_min_cm": suggested_min,
        "suggested_max_cm": suggested_max,
        "distance_min_cm": min(distances) if distances else None,
        "distance_p10_cm": p10,
        "distance_median_cm": p50,
        "distance_p90_cm": p90,
        "distance_max_cm": max(distances) if distances else None,
        "stable_rate": round(len(stable_rows) / max(1, len(in_bed_rows)), 3),
    }


def get_sleep_series():
    start, end = current_night_window()
    rows = get_readings_between(start, end)
    max_points = 360

    if len(rows) > max_points:
        step = max(1, len(rows) // max_points)
        sampled = rows[::step]
        if sampled[-1]["id"] != rows[-1]["id"]:
            sampled.append(rows[-1])
    else:
        sampled = rows

    return {
        "window_start": start.isoformat(timespec="seconds"),
        "window_end": end.isoformat(timespec="seconds"),
        "points": [
            {
                "ts": row.get("ts"),
                "sleep_score": as_int(row.get("sleep_score")) or 0,
                "threshold": as_int(row.get("threshold")),
                "in_bed": as_int(row.get("in_bed")) or 0,
                "stable": as_int(row.get("stable")) or 0,
                "dist_filtered": as_int(row.get("dist_filtered")),
                "tv_command_sent": as_int(row.get("tv_command_sent")) or 0,
                "score_reason": row.get("score_reason"),
            }
            for row in sampled
        ],
    }
