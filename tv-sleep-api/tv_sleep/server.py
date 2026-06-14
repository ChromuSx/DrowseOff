import csv
import io
import json
import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .config import HOST, PORT, STATIC_DIR, TEMPLATES_DIR
from .db import (
    COMMAND_COLUMNS,
    EVENT_COLUMNS,
    READING_COLUMNS,
    clear_all_data,
    cancel_command,
    claim_next_command,
    complete_command,
    create_command,
    ensure_db,
    get_commands,
    get_commands_for_export,
    get_events,
    get_events_for_export,
    get_latest,
    get_readings,
    get_readings_for_export,
    get_settings,
    get_summary,
    insert_event,
    insert_reading,
    update_settings,
)
from .reports import get_calibration_report, get_morning_report, get_night_report, get_sleep_series
from .time_utils import now_iso


def limited_query_param(query, name, default, maximum):
    raw = parse_qs(query).get(name, [str(default)])[0]
    try:
        value = int(raw)
    except ValueError:
        value = default
    return max(1, min(value, maximum))


def dashboard_html():
    return (TEMPLATES_DIR / "dashboard.html").read_text(encoding="utf-8")


def command_payload(command):
    if not command:
        return None

    return {
        "id": command["id"],
        "command_type": command["command_type"],
        "repeat_count": command.get("repeat_count") or 1,
        "created_at": command["created_at"],
        "claimed_at": command["claimed_at"],
        "expires_at": command.get("expires_at"),
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, html):
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, path):
        relative = path.removeprefix("/static/").lstrip("/")
        target = (STATIC_DIR / relative).resolve()

        try:
            target.relative_to(STATIC_DIR.resolve())
        except ValueError:
            self.send_json(404, {"error": "not found"})
            return

        if not target.is_file():
            self.send_json(404, {"error": "not found"})
            return

        body = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_csv(self, filename, rows, columns):
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

        body = buffer.getvalue().encode("utf-8-sig")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="{filename}"',
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/":
            self.send_html(dashboard_html())
            return

        if parsed.path.startswith("/static/"):
            self.send_static(parsed.path)
            return

        if parsed.path == "/api/health":
            self.send_json(200, {"status": "ok", "time": now_iso()})
            return

        if parsed.path == "/api/latest":
            self.send_json(200, get_latest() or {})
            return

        if parsed.path == "/api/readings":
            limit = limited_query_param(parsed.query, "limit", 100, 1000)
            self.send_json(200, get_readings(limit))
            return

        if parsed.path == "/api/events":
            limit = limited_query_param(parsed.query, "limit", 100, 1000)
            self.send_json(200, get_events(limit))
            return

        if parsed.path == "/api/commands":
            limit = limited_query_param(parsed.query, "limit", 100, 1000)
            self.send_json(200, get_commands(limit))
            return

        if parsed.path == "/api/commands/next":
            query = parse_qs(parsed.query)
            device_id = query.get("device_id", ["camera-tv-esp32"])[0]
            command = claim_next_command(device_id)
            self.send_json(200, {"ok": True, "command": command_payload(command)})
            return

        if parsed.path == "/api/settings":
            self.send_json(200, get_settings())
            return

        if parsed.path == "/api/settings/device":
            self.send_json(200, get_settings())
            return

        if parsed.path == "/api/export/readings.csv":
            self.send_csv(
                "tv-sleep-readings.csv",
                get_readings_for_export(),
                READING_COLUMNS,
            )
            return

        if parsed.path == "/api/export/events.csv":
            self.send_csv(
                "tv-sleep-events.csv",
                get_events_for_export(),
                EVENT_COLUMNS,
            )
            return

        if parsed.path == "/api/export/commands.csv":
            self.send_csv(
                "tv-sleep-commands.csv",
                get_commands_for_export(),
                COMMAND_COLUMNS,
            )
            return

        if parsed.path == "/api/summary":
            self.send_json(200, get_summary())
            return

        if parsed.path == "/api/night":
            self.send_json(200, get_night_report())
            return

        if parsed.path == "/api/morning-report":
            self.send_json(200, get_morning_report())
            return

        if parsed.path == "/api/calibration":
            limit = limited_query_param(parsed.query, "limit", 500, 5000)
            self.send_json(200, get_calibration_report(limit))
            return

        if parsed.path == "/api/sleep-series":
            self.send_json(200, get_sleep_series())
            return

        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)

        try:
            payload = self.read_json()

            if parsed.path == "/api/readings":
                reading_id = insert_reading(payload)
                self.send_json(201, {"ok": True, "id": reading_id})
                return

            if parsed.path == "/api/events":
                event_id = insert_event(payload)
                self.send_json(201, {"ok": True, "id": event_id})
                return

            if parsed.path == "/api/commands":
                command_type = payload.get("command_type") or "tv_power"
                if command_type != "tv_power":
                    self.send_json(400, {"error": "unsupported command"})
                    return

                command_id = create_command(
                    {
                        **payload,
                        "command_type": command_type,
                        "source": payload.get("source") or "dashboard",
                    }
                )
                self.send_json(201, {"ok": True, "id": command_id})
                return

            if parsed.path == "/api/commands/cancel":
                command_id = int(payload.get("id") or 0)
                command = cancel_command(command_id)
                if not command:
                    self.send_json(404, {"error": "pending command not found"})
                    return

                self.send_json(200, {"ok": True, "command": command})
                return

            if parsed.path == "/api/commands/complete":
                command_id = int(payload.get("id") or 0)
                status = payload.get("status") or "done"
                note = payload.get("note")

                command = complete_command(command_id, status, note)
                if not command:
                    self.send_json(404, {"error": "command not found"})
                    return

                if command["command_type"] == "tv_power":
                    insert_event(
                        {
                            "device_id": command["device_id"],
                            "event_type": (
                                "tv_power_manual"
                                if command["status"] == "done"
                                else "tv_power_manual_failed"
                            ),
                            "sleep_score": payload.get("sleep_score"),
                            "dist_filtered": payload.get("dist_filtered"),
                            "note": note or "Comando POWER richiesto da dashboard",
                        }
                    )

                self.send_json(200, {"ok": True, "command": command})
                return

            if parsed.path == "/api/settings":
                settings = update_settings(payload)
                self.send_json(200, {"ok": True, "settings": settings})
                return

            if parsed.path == "/api/clear":
                if payload.get("confirm") != "SVUOTA":
                    self.send_json(400, {"error": "missing confirmation"})
                    return

                result = clear_all_data()
                self.send_json(200, {"ok": True, **result})
                return

            self.send_json(404, {"error": "not found"})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "invalid json"})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def run():
    ensure_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"TV Sleep API listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping...")
        time.sleep(0.1)
