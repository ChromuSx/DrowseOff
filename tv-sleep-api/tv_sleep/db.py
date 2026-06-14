import os
import sqlite3
from datetime import datetime, timedelta

from .config import DB_PATH
from .time_utils import now_iso


READING_COLUMNS = [
    "id",
    "ts",
    "received_at",
    "device_id",
    "mode",
    "threshold",
    "radar_ok",
    "presence",
    "in_bed",
    "moving",
    "still",
    "stable",
    "energy_moving",
    "energy_still",
    "dist_raw",
    "dist_filtered",
    "dist_change",
    "sleep_score",
    "out_of_bed_count",
    "tv_command_sent",
    "score_reason",
]

EVENT_COLUMNS = [
    "id",
    "ts",
    "received_at",
    "device_id",
    "event_type",
    "sleep_score",
    "dist_filtered",
    "note",
]

COMMAND_COLUMNS = [
    "id",
    "created_at",
    "claimed_at",
    "completed_at",
    "device_id",
    "command_type",
    "repeat_count",
    "status",
    "expires_at",
    "source",
    "note",
]

DEFAULT_SETTINGS = {
    "sleep_threshold": 600,
    "distance_min_cm": 40,
    "distance_max_cm": 120,
    "distance_quiet_cm": 25,
    "distance_strong_cm": 55,
    "out_of_bed_limit": 8,
    "ir_repeats": 2,
    "command_ttl_seconds": 120,
    "auto_power_enabled": 1,
}

SETTING_LIMITS = {
    "sleep_threshold": (30, 3600),
    "distance_min_cm": (20, 400),
    "distance_max_cm": (30, 600),
    "distance_quiet_cm": (1, 120),
    "distance_strong_cm": (5, 200),
    "out_of_bed_limit": (1, 60),
    "ir_repeats": (0, 5),
    "command_ttl_seconds": (15, 900),
    "auto_power_enabled": (0, 1),
}


def ensure_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                received_at TEXT NOT NULL,
                device_id TEXT NOT NULL,
                mode TEXT,
                threshold INTEGER,
                radar_ok INTEGER,
                presence INTEGER,
                in_bed INTEGER,
                moving INTEGER,
                still INTEGER,
                stable INTEGER,
                energy_moving INTEGER,
                energy_still INTEGER,
                dist_raw INTEGER,
                dist_filtered INTEGER,
                dist_change INTEGER,
                sleep_score INTEGER,
                out_of_bed_count INTEGER,
                tv_command_sent INTEGER,
                score_reason TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                received_at TEXT NOT NULL,
                device_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                sleep_score INTEGER,
                dist_filtered INTEGER,
                note TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                claimed_at TEXT,
                completed_at TEXT,
                device_id TEXT NOT NULL,
                command_type TEXT NOT NULL,
                repeat_count INTEGER DEFAULT 1,
                status TEXT NOT NULL,
                expires_at TEXT,
                source TEXT,
                note TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        migrate_readings_table(conn)
        migrate_commands_table(conn)
        ensure_default_settings(conn)

        conn.execute("CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_commands_device ON commands(device_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_commands_expires ON commands(expires_at)")


def migrate_readings_table(conn):
    cursor = conn.execute("PRAGMA table_info(readings)")
    columns = {row[1] for row in cursor.fetchall()}

    if "score_reason" not in columns:
        conn.execute("ALTER TABLE readings ADD COLUMN score_reason TEXT")


def migrate_commands_table(conn):
    cursor = conn.execute("PRAGMA table_info(commands)")
    columns = {row[1] for row in cursor.fetchall()}

    if "repeat_count" not in columns:
        conn.execute("ALTER TABLE commands ADD COLUMN repeat_count INTEGER DEFAULT 1")

    if "expires_at" not in columns:
        conn.execute("ALTER TABLE commands ADD COLUMN expires_at TEXT")


def ensure_default_settings(conn):
    updated_at = now_iso()

    for key, value in DEFAULT_SETTINGS.items():
        conn.execute(
            """
            INSERT OR IGNORE INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            """,
            (key, str(value), updated_at),
        )


def as_int(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def bounded_int(value, default, minimum, maximum):
    parsed = as_int(value)
    if parsed is None:
        parsed = default
    return max(minimum, min(parsed, maximum))


def command_expires_at(ttl_seconds=None):
    settings = get_settings()
    ttl = bounded_int(
        ttl_seconds,
        settings["command_ttl_seconds"],
        *SETTING_LIMITS["command_ttl_seconds"],
    )
    return (datetime.now().astimezone() + timedelta(seconds=ttl)).isoformat(
        timespec="seconds"
    )


def row_to_dict(cursor, row):
    return {
        description[0]: row[index]
        for index, description in enumerate(cursor.description)
    }


def insert_reading(payload):
    received_at = now_iso()
    ts = payload.get("ts") or received_at
    device_id = str(payload.get("device_id") or "esp32-tv-sleep")

    values = {
        "ts": ts,
        "received_at": received_at,
        "device_id": device_id,
        "mode": payload.get("mode"),
        "threshold": as_int(payload.get("threshold")),
        "radar_ok": as_int(payload.get("radar_ok")),
        "presence": as_int(payload.get("presence")),
        "in_bed": as_int(payload.get("in_bed")),
        "moving": as_int(payload.get("moving")),
        "still": as_int(payload.get("still")),
        "stable": as_int(payload.get("stable")),
        "energy_moving": as_int(payload.get("energy_moving")),
        "energy_still": as_int(payload.get("energy_still")),
        "dist_raw": as_int(payload.get("dist_raw")),
        "dist_filtered": as_int(payload.get("dist_filtered")),
        "dist_change": as_int(payload.get("dist_change")),
        "sleep_score": as_int(payload.get("sleep_score")),
        "out_of_bed_count": as_int(payload.get("out_of_bed_count")),
        "tv_command_sent": as_int(payload.get("tv_command_sent")),
        "score_reason": payload.get("score_reason"),
    }

    columns = ", ".join(values.keys())
    placeholders = ", ".join(["?"] * len(values))

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            f"INSERT INTO readings ({columns}) VALUES ({placeholders})",
            list(values.values()),
        )
        return cursor.lastrowid


def insert_event(payload):
    received_at = now_iso()
    ts = payload.get("ts") or received_at
    device_id = str(payload.get("device_id") or "esp32-tv-sleep")
    event_type = str(payload.get("event_type") or "unknown")

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO events (
                ts, received_at, device_id, event_type, sleep_score,
                dist_filtered, note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts,
                received_at,
                device_id,
                event_type,
                as_int(payload.get("sleep_score")),
                as_int(payload.get("dist_filtered")),
                payload.get("note"),
            ),
        )
        return cursor.lastrowid


def get_readings(limit):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "SELECT * FROM readings ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        return [row_to_dict(cursor, row) for row in cursor.fetchall()]


def get_readings_for_export():
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("SELECT * FROM readings ORDER BY id ASC")
        return [row_to_dict(cursor, row) for row in cursor.fetchall()]


def get_readings_between(start, end):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            SELECT * FROM readings
            WHERE ts >= ? AND ts < ?
            ORDER BY ts ASC
            """,
            (start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds")),
        )
        return [row_to_dict(cursor, row) for row in cursor.fetchall()]


def get_latest():
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("SELECT * FROM readings ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        return row_to_dict(cursor, row) if row else None


def get_events(limit):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "SELECT * FROM events ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        return [row_to_dict(cursor, row) for row in cursor.fetchall()]


def get_events_for_export():
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("SELECT * FROM events ORDER BY id ASC")
        return [row_to_dict(cursor, row) for row in cursor.fetchall()]


def get_settings():
    with sqlite3.connect(DB_PATH) as conn:
        ensure_default_settings(conn)
        cursor = conn.execute("SELECT key, value, updated_at FROM settings")
        rows = cursor.fetchall()

    settings = dict(DEFAULT_SETTINGS)
    updated_at = None

    for key, value, row_updated_at in rows:
        if key not in DEFAULT_SETTINGS:
            continue

        minimum, maximum = SETTING_LIMITS[key]
        settings[key] = bounded_int(value, DEFAULT_SETTINGS[key], minimum, maximum)
        updated_at = max(updated_at or row_updated_at, row_updated_at)

    settings["updated_at"] = updated_at
    return settings


def update_settings(payload):
    updated_at = now_iso()
    changed = {}

    for key, default in DEFAULT_SETTINGS.items():
        if key not in payload:
            continue

        minimum, maximum = SETTING_LIMITS[key]
        changed[key] = bounded_int(payload.get(key), default, minimum, maximum)

    with sqlite3.connect(DB_PATH) as conn:
        ensure_default_settings(conn)

        for key, value in changed.items():
            conn.execute(
                """
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (key, str(value), updated_at),
            )

    return get_settings()


def create_command(payload):
    created_at = now_iso()
    device_id = str(payload.get("device_id") or "camera-tv-esp32")
    command_type = str(payload.get("command_type") or "tv_power")
    repeat_count = bounded_int(payload.get("repeat_count"), 1, 1, 5)
    expires_at = command_expires_at(payload.get("ttl_seconds"))

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO commands (
                created_at, device_id, command_type, repeat_count, status,
                expires_at, source, note
            )
            VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
            """,
            (
                created_at,
                device_id,
                command_type,
                repeat_count,
                expires_at,
                payload.get("source") or "dashboard",
                payload.get("note"),
            ),
        )
        return cursor.lastrowid


def expire_old_commands(conn=None):
    should_close = conn is None

    if conn is None:
        conn = sqlite3.connect(DB_PATH)

    try:
        conn.execute(
            """
            UPDATE commands
            SET status = 'expired', completed_at = COALESCE(completed_at, ?)
            WHERE status = 'pending'
              AND expires_at IS NOT NULL
              AND expires_at < ?
            """,
            (now_iso(), now_iso()),
        )
        if should_close:
            conn.commit()
    finally:
        if should_close:
            conn.close()


def get_commands(limit):
    with sqlite3.connect(DB_PATH) as conn:
        expire_old_commands(conn)
        cursor = conn.execute(
            "SELECT * FROM commands ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        return [row_to_dict(cursor, row) for row in cursor.fetchall()]


def get_commands_for_export():
    with sqlite3.connect(DB_PATH) as conn:
        expire_old_commands(conn)
        cursor = conn.execute("SELECT * FROM commands ORDER BY id ASC")
        return [row_to_dict(cursor, row) for row in cursor.fetchall()]


def claim_next_command(device_id):
    claimed_at = now_iso()

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("BEGIN IMMEDIATE")
        expire_old_commands(conn)
        cursor = conn.execute(
            """
            SELECT * FROM commands
            WHERE status = 'pending'
              AND device_id IN (?, '*')
              AND (expires_at IS NULL OR expires_at >= ?)
            ORDER BY id ASC
            LIMIT 1
            """,
            (device_id, now_iso()),
        )
        row = cursor.fetchone()

        if not row:
            return None

        command = row_to_dict(cursor, row)
        conn.execute(
            """
            UPDATE commands
            SET status = 'claimed', claimed_at = ?
            WHERE id = ?
            """,
            (claimed_at, command["id"]),
        )
        command["status"] = "claimed"
        command["claimed_at"] = claimed_at
        return command


def get_command(command_id):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "SELECT * FROM commands WHERE id = ?",
            (command_id,),
        )
        row = cursor.fetchone()
        return row_to_dict(cursor, row) if row else None


def complete_command(command_id, status, note=None):
    completed_at = now_iso()
    status = status if status in ("done", "failed", "cancelled", "expired") else "done"

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            UPDATE commands
            SET status = ?, completed_at = ?, note = COALESCE(?, note)
            WHERE id = ?
            """,
            (status, completed_at, note, command_id),
        )

    if cursor.rowcount == 0:
        return None

    return get_command(command_id)


def cancel_command(command_id):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            UPDATE commands
            SET status = 'cancelled', completed_at = ?, note = COALESCE(note, ?)
            WHERE id = ? AND status = 'pending'
            """,
            (now_iso(), "Annullato dalla dashboard", command_id),
        )

    if cursor.rowcount == 0:
        return None

    return get_command(command_id)


def get_last_power_event(start=None, end=None):
    query = """
        SELECT * FROM events
        WHERE event_type = 'tv_power_off_attempt'
    """
    params = []

    if start and end:
        query += " AND ts >= ? AND ts < ?"
        params.extend(
            [
                start.isoformat(timespec="seconds"),
                end.isoformat(timespec="seconds"),
            ]
        )

    query += " ORDER BY ts DESC LIMIT 1"

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(query, params)
        row = cursor.fetchone()
        return row_to_dict(cursor, row) if row else None


def get_summary():
    with sqlite3.connect(DB_PATH) as conn:
        expire_old_commands(conn)
        cursor = conn.execute(
            """
            SELECT
                COUNT(*) AS readings,
                MAX(ts) AS last_ts,
                MAX(sleep_score) AS max_sleep_score,
                SUM(CASE WHEN tv_command_sent = 1 THEN 1 ELSE 0 END) AS tv_commands
            FROM readings
            """
        )
        summary = row_to_dict(cursor, cursor.fetchone())

        cursor = conn.execute("SELECT COUNT(*) AS events FROM events")
        summary.update(row_to_dict(cursor, cursor.fetchone()))

        cursor = conn.execute(
            """
            SELECT
                COUNT(*) AS commands,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_commands
            FROM commands
            """
        )
        summary.update(row_to_dict(cursor, cursor.fetchone()))
        return summary


def clear_all_data():
    with sqlite3.connect(DB_PATH) as conn:
        reading_cursor = conn.execute("DELETE FROM readings")
        event_cursor = conn.execute("DELETE FROM events")
        command_cursor = conn.execute("DELETE FROM commands")
        conn.execute(
            "DELETE FROM sqlite_sequence WHERE name IN ('readings', 'events', 'commands')"
        )
        return {
            "readings_deleted": reading_cursor.rowcount,
            "events_deleted": event_cursor.rowcount,
            "commands_deleted": command_cursor.rowcount,
        }
