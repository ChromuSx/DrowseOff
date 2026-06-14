import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"


def env_value(name, default=""):
    value = os.environ.get(name, "").strip()
    if value:
        return value

    return default


def env_flag(name, default="0"):
    return env_value(name, default).lower() in ("1", "true", "yes", "on")


DB_PATH = env_value("DROWSEOFF_DB", "/data/drowseoff.db")
HOST = env_value("DROWSEOFF_HOST", "0.0.0.0")
PORT = int(env_value("DROWSEOFF_PORT", "8010"))
API_TOKEN = env_value("DROWSEOFF_API_TOKEN", "")
ALLOW_UNAUTHENTICATED_API = env_flag(
    "DROWSEOFF_ALLOW_UNAUTHENTICATED_API",
    "0",
)
CORS_ALLOW_ORIGIN = env_value(
    "DROWSEOFF_CORS_ORIGIN",
    "",
)
DEFAULT_SENSOR_DEVICE_ID = env_value(
    "DROWSEOFF_DEFAULT_SENSOR_DEVICE_ID",
    "drowseoff-sensor",
)
REMOTE_PROVIDER = env_value(
    "DROWSEOFF_REMOTE_PROVIDER",
    "broadlink",
).lower()
REMOTE_AUTO_ENABLED = env_value(
    "DROWSEOFF_REMOTE_AUTO_ENABLED",
    "1",
).lower() not in (
    "0",
    "false",
    "no",
    "off",
)
