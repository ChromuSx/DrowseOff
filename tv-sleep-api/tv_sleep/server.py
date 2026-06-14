import csv
import hmac
import io
import json
import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .config import (
    ALLOW_UNAUTHENTICATED_API,
    API_TOKEN,
    CORS_ALLOW_ORIGIN,
    DEFAULT_SENSOR_DEVICE_ID,
    HOST,
    PORT,
    REMOTE_AUTO_ENABLED,
    STATIC_DIR,
    TEMPLATES_DIR,
)
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
from .remote_control import (
    remote_check_learning,
    remote_probe,
    remote_send_tv_off,
    remote_start_learning,
    remote_status,
)
from .reports import (
    get_calibration_report,
    get_session_report,
    get_session_summary,
    get_sleep_series,
)
from .time_utils import now_iso

MAX_JSON_BODY_BYTES = 64 * 1024


def limited_query_param(query, name, default, maximum):
    raw = parse_qs(query).get(name, [str(default)])[0]
    try:
        value = int(raw)
    except ValueError:
        value = default
    return max(1, min(value, maximum))


def int_payload(payload, name, default=0):
    raw = payload.get(name, default)
    try:
        return int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an integer") from exc


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


def try_send_remote_auto(payload):
    if not REMOTE_AUTO_ENABLED:
        return {
            "ok": False,
            "status": "disabled",
            "error": "automatic remote is disabled",
        }

    try:
        result = remote_send_tv_off(1)
        event_id = insert_event(
            {
                "device_id": f"remote-{result['provider']}",
                "event_type": "tv_off_remote_auto",
                "sleep_score": payload.get("sleep_score"),
                "dist_filtered": payload.get("dist_filtered"),
                "note": f"TV OFF sent by {result['provider']} x{result['repeat_count']}",
            }
        )
        return {
            "ok": True,
            "status": "sent",
            "event_id": event_id,
            **result,
        }
    except Exception as exc:
        event_id = insert_event(
            {
                "device_id": "remote",
                "event_type": "tv_off_remote_failed",
                "sleep_score": payload.get("sleep_score"),
                "dist_filtered": payload.get("dist_filtered"),
                "note": f"Automatic remote error: {exc}",
            }
        )
        return {
            "ok": False,
            "status": "failed",
            "event_id": event_id,
            "error": str(exc),
        }


class Handler(BaseHTTPRequestHandler):
    def cors_allowed_origin(self):
        if not CORS_ALLOW_ORIGIN:
            return None

        if CORS_ALLOW_ORIGIN == "*":
            return "*"

        request_origin = self.headers.get("Origin", "")
        allowed_origins = [
            origin.strip()
            for origin in CORS_ALLOW_ORIGIN.split(",")
            if origin.strip()
        ]

        if request_origin in allowed_origins:
            return request_origin

        return None

    def send_auth_headers(self):
        allowed_origin = self.cors_allowed_origin()
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            if allowed_origin != "*":
                self.send_header("Vary", "Origin")

        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-TV-Sleep-Token, Authorization",
        )

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_auth_headers()
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
        self.send_auth_headers()
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="{filename}"',
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc

        if length < 0:
            raise ValueError("invalid Content-Length")

        if length > MAX_JSON_BODY_BYTES:
            raise ValueError("request body too large")

        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def request_token(self):
        auth_header = self.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            return auth_header[7:].strip()
        return self.headers.get("X-TV-Sleep-Token", "").strip()

    def require_api_auth(self, path):
        if not path.startswith("/api/") or path == "/api/health":
            return True

        if not API_TOKEN:
            if ALLOW_UNAUTHENTICATED_API:
                return True

            self.send_json(
                503,
                {
                    "error": (
                        "API token is not configured. Set DROWSEOFF_API_TOKEN "
                        "or explicitly set DROWSEOFF_ALLOW_UNAUTHENTICATED_API=1."
                    )
                },
            )
            return False

        if hmac.compare_digest(self.request_token(), API_TOKEN):
            return True

        self.send_json(401, {"error": "authentication required"})
        return False

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_auth_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if not self.require_api_auth(parsed.path):
            return

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
            device_id = query.get("device_id", [DEFAULT_SENSOR_DEVICE_ID])[0]
            command = claim_next_command(device_id)
            self.send_json(200, {"ok": True, "command": command_payload(command)})
            return

        if parsed.path == "/api/settings":
            self.send_json(200, get_settings())
            return

        if parsed.path == "/api/settings/device":
            self.send_json(200, get_settings())
            return

        if parsed.path == "/api/remote/status":
            self.send_json(200, remote_status())
            return

        if parsed.path == "/api/remote/probe":
            try:
                self.send_json(200, remote_probe())
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
            return

        if parsed.path == "/api/export/readings.csv":
            self.send_csv(
                "drowseoff-readings.csv",
                get_readings_for_export(),
                READING_COLUMNS,
            )
            return

        if parsed.path == "/api/export/events.csv":
            self.send_csv(
                "drowseoff-events.csv",
                get_events_for_export(),
                EVENT_COLUMNS,
            )
            return

        if parsed.path == "/api/export/commands.csv":
            self.send_csv(
                "drowseoff-commands.csv",
                get_commands_for_export(),
                COMMAND_COLUMNS,
            )
            return

        if parsed.path == "/api/summary":
            self.send_json(200, get_summary())
            return

        if parsed.path == "/api/session":
            self.send_json(200, get_session_report())
            return

        if parsed.path == "/api/session-summary":
            self.send_json(200, get_session_summary())
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
            if not self.require_api_auth(parsed.path):
                return

            payload = self.read_json()

            if parsed.path == "/api/readings":
                reading_id = insert_reading(payload)
                self.send_json(201, {"ok": True, "id": reading_id})
                return

            if parsed.path == "/api/events":
                event_id = insert_event(payload)
                if payload.get("event_type") == "tv_power_off_attempt":
                    remote_result = try_send_remote_auto(payload)
                    if not remote_result["ok"]:
                        status = 409 if remote_result["status"] == "disabled" else 503
                        self.send_json(
                            status,
                            {
                                "ok": False,
                                "id": event_id,
                                "remote": remote_result,
                                "error": remote_result["error"],
                            },
                        )
                        return

                    self.send_json(201, {"ok": True, "id": event_id, "remote": remote_result})
                    return

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

            if parsed.path == "/api/remote/learn/start":
                self.send_json(200, {"ok": True, **remote_start_learning()})
                return

            if parsed.path == "/api/remote/learn/check":
                self.send_json(200, {"ok": True, **remote_check_learning()})
                return

            if parsed.path == "/api/remote/send-off":
                repeat_count = int_payload(payload, "repeat_count", 1)
                provider = remote_status().get("provider", "remote")
                command_id = create_command(
                    {
                        "device_id": f"remote-{provider}",
                        "command_type": "tv_off",
                        "repeat_count": repeat_count,
                        "source": payload.get("source") or f"dashboard-{provider}",
                        "note": f"Requested from dashboard via {provider}",
                    }
                )

                try:
                    result = remote_send_tv_off(repeat_count)
                    complete_command(
                        command_id,
                        "done",
                        f"TV OFF sent by {result['provider']} x{result['repeat_count']}",
                    )
                    insert_event(
                        {
                            "device_id": f"remote-{result['provider']}",
                            "event_type": "tv_off_remote_manual",
                            "note": f"Manual TV OFF sent by {result['provider']} x{result['repeat_count']}",
                        }
                    )
                    self.send_json(200, {"ok": True, "id": command_id, **result})
                except Exception as exc:
                    complete_command(command_id, "failed", str(exc))
                    insert_event(
                        {
                            "device_id": f"remote-{provider}",
                            "event_type": "tv_off_remote_failed",
                            "note": f"Manual remote error: {exc}",
                        }
                    )
                    raise
                return

            if parsed.path == "/api/commands/cancel":
                command_id = int_payload(payload, "id", 0)
                command = cancel_command(command_id)
                if not command:
                    self.send_json(404, {"error": "pending command not found"})
                    return

                self.send_json(200, {"ok": True, "command": command})
                return

            if parsed.path == "/api/commands/complete":
                command_id = int_payload(payload, "id", 0)
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
                            "note": note or "TV OFF requested from dashboard",
                        }
                    )

                self.send_json(200, {"ok": True, "command": command})
                return

            if parsed.path == "/api/settings":
                settings = update_settings(payload)
                self.send_json(200, {"ok": True, "settings": settings})
                return

            if parsed.path == "/api/clear":
                if payload.get("confirm") != "CLEAR":
                    self.send_json(400, {"error": "missing confirmation"})
                    return

                result = clear_all_data()
                self.send_json(200, {"ok": True, **result})
                return

            self.send_json(404, {"error": "not found"})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "invalid json"})
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def run():
    ensure_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"DrowseOff API listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping...")
        time.sleep(0.1)
