import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"


def env_value(name, default="", legacy_name=None):
    value = os.environ.get(name, "").strip()
    if value:
        return value

    if legacy_name:
        legacy_value = os.environ.get(legacy_name, "").strip()
        if legacy_value:
            return legacy_value

    return default


def env_flag(name, default="0", legacy_name=None):
    return env_value(name, default, legacy_name).lower() in ("1", "true", "yes", "on")


DB_PATH = env_value("DROWSEOFF_DB", "/data/drowseoff.db", "TV_SLEEP_DB")
HOST = env_value("DROWSEOFF_HOST", "0.0.0.0", "TV_SLEEP_HOST")
PORT = int(env_value("DROWSEOFF_PORT", "8010", "TV_SLEEP_PORT"))
API_TOKEN = env_value("DROWSEOFF_API_TOKEN", "", "TV_SLEEP_API_TOKEN")
ALLOW_UNAUTHENTICATED_API = env_flag(
    "DROWSEOFF_ALLOW_UNAUTHENTICATED_API",
    "0",
    "TV_SLEEP_ALLOW_UNAUTHENTICATED_API",
)
CORS_ALLOW_ORIGIN = env_value(
    "DROWSEOFF_CORS_ORIGIN",
    "",
    "TV_SLEEP_CORS_ORIGIN",
)
DEFAULT_SENSOR_DEVICE_ID = env_value(
    "DROWSEOFF_DEFAULT_SENSOR_DEVICE_ID",
    "drowseoff-sensor",
    "DEFAULT_SENSOR_DEVICE_ID",
)
REMOTE_PROVIDER = env_value(
    "DROWSEOFF_REMOTE_PROVIDER",
    "broadlink",
    "REMOTE_PROVIDER",
).lower()
REMOTE_AUTO_ENABLED = env_value(
    "DROWSEOFF_REMOTE_AUTO_ENABLED",
    "1",
    "REMOTE_AUTO_ENABLED",
).lower() not in (
    "0",
    "false",
    "no",
    "off",
)
