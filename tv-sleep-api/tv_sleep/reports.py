from .db import as_int, get_last_power_event, get_readings, get_settings
from .time_utils import parse_iso_datetime


SESSION_LOOKBACK_ROWS = 5000
SESSION_BREAK_SECONDS = 10 * 60


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


def timestamp(row):
    return parse_iso_datetime(row.get("ts"))


def seconds_between(left, right):
    left_ts = timestamp(left)
    right_ts = timestamp(right)

    if not left_ts or not right_ts:
        return 10

    return max(0, int((right_ts - left_ts).total_seconds()))


def sorted_recent_readings(limit=SESSION_LOOKBACK_ROWS):
    rows = get_readings(limit)
    return sorted(
        [row for row in rows if timestamp(row)],
        key=lambda row: timestamp(row),
    )


def find_recent_session(rows):
    if not rows:
        return [], False

    last_in_bed_index = None

    for index in range(len(rows) - 1, -1, -1):
        if as_int(rows[index].get("in_bed")) == 1:
            last_in_bed_index = index
            break

    if last_in_bed_index is None:
        return [], False

    start_index = last_in_bed_index
    out_seconds = 0

    for index in range(last_in_bed_index - 1, -1, -1):
        gap = seconds_between(rows[index], rows[index + 1])

        if as_int(rows[index].get("in_bed")) == 1:
            out_seconds = 0
            start_index = index
        else:
            out_seconds += gap
            if out_seconds >= SESSION_BREAK_SECONDS:
                start_index = index + 1
                break

    end_index = last_in_bed_index
    out_seconds_after = 0
    active = True

    for index in range(last_in_bed_index + 1, len(rows)):
        gap = seconds_between(rows[index - 1], rows[index])
        end_index = index

        if as_int(rows[index].get("in_bed")) == 1:
            out_seconds_after = 0
        else:
            out_seconds_after += gap
            if out_seconds_after >= SESSION_BREAK_SECONDS:
                active = False
                break

    if end_index == len(rows) - 1 and out_seconds_after >= SESSION_BREAK_SECONDS:
        active = False

    return rows[start_index : end_index + 1], active


def get_session_report():
    all_rows = sorted_recent_readings()
    rows, active = find_recent_session(all_rows)
    first_in_bed = next((row for row in rows if row.get("in_bed")), None)
    max_sleep_score = max([as_int(row.get("sleep_score")) or 0 for row in rows] or [0])
    tv_commands = sum(1 for row in rows if row.get("tv_command_sent"))
    out_of_bed_readings = sum(
        1 for row in rows if row.get("presence") and not row.get("in_bed")
    )

    mode = last_value(rows, "mode")
    threshold = last_value(rows, "threshold")
    start_ts = timestamp(rows[0]) if rows else None
    end_ts = timestamp(rows[-1]) if rows else None

    return {
        "window_start": start_ts.isoformat(timespec="seconds") if start_ts else None,
        "window_end": end_ts.isoformat(timespec="seconds") if end_ts else None,
        "session_active": active,
        "session_break_seconds": SESSION_BREAK_SECONDS,
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
        "session_power_event": (
            get_last_power_event(start_ts, end_ts) if start_ts and end_ts else None
        ),
    }


def get_session_summary():
    session = get_session_report()
    power_event = session.get("session_power_event")
    state = "attiva" if session.get("session_active") else "conclusa"

    if session["readings"] == 0:
        summary = "Non ci sono ancora letture in una sessione riconoscibile."
    elif power_event:
        summary = (
            f"TV comandata alle {power_event['ts']} "
            f"con punteggio {power_event.get('sleep_score', '-') }."
        )
    else:
        summary = (
            f"Sessione {state}. Nessun comando TV registrato. "
            f"Punteggio massimo: {session['max_sleep_score']}."
        )

    return {
        "summary": summary,
        "readings": session["readings"],
        "window_start": session["window_start"],
        "window_end": session["window_end"],
        "session_active": session["session_active"],
        "session_break_seconds": session["session_break_seconds"],
        "first_in_bed_ts": session["first_in_bed_ts"],
        "last_ts": session["last_ts"],
        "max_sleep_score": session["max_sleep_score"],
        "threshold": session["threshold"],
        "in_bed_seconds": session["in_bed_seconds"],
        "stable_seconds": session["stable_seconds"],
        "out_of_bed_readings": session["out_of_bed_readings"],
        "tv_commands": session["tv_commands"],
        "session_power_event": power_event,
    }


def get_night_report():
    report = get_session_report()
    report["night_power_event"] = report.get("session_power_event")
    return report


def get_morning_report():
    report = get_session_summary()
    report["night_power_event"] = report.get("session_power_event")
    return report


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
    rows, _active = find_recent_session(sorted_recent_readings())
    max_points = 360

    if len(rows) > max_points:
        step = max(1, len(rows) // max_points)
        sampled = rows[::step]
        if sampled[-1]["id"] != rows[-1]["id"]:
            sampled.append(rows[-1])
    else:
        sampled = rows

    start_ts = timestamp(rows[0]) if rows else None
    end_ts = timestamp(rows[-1]) if rows else None

    return {
        "window_start": start_ts.isoformat(timespec="seconds") if start_ts else None,
        "window_end": end_ts.isoformat(timespec="seconds") if end_ts else None,
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
