from datetime import datetime, timedelta, timezone


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def parse_iso_datetime(value):
    if not value:
        return None

    text = str(value)
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)

    return parsed.astimezone()


def current_night_window():
    now = datetime.now().astimezone()
    if now.hour >= 20:
        start = now.replace(hour=20, minute=0, second=0, microsecond=0)
    else:
        start = (now - timedelta(days=1)).replace(
            hour=20, minute=0, second=0, microsecond=0
        )
    return start, start + timedelta(hours=16)
