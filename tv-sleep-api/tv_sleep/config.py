import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

DB_PATH = os.environ.get("TV_SLEEP_DB", "/data/tv_sleep.db")
HOST = os.environ.get("TV_SLEEP_HOST", "0.0.0.0")
PORT = int(os.environ.get("TV_SLEEP_PORT", "8010"))
API_TOKEN = os.environ.get("TV_SLEEP_API_TOKEN", "").strip()
DEFAULT_SENSOR_DEVICE_ID = os.environ.get(
    "DEFAULT_SENSOR_DEVICE_ID",
    "tv-sleep-sensor",
)
REMOTE_PROVIDER = os.environ.get("REMOTE_PROVIDER", "broadlink").lower()
REMOTE_AUTO_ENABLED = os.environ.get("REMOTE_AUTO_ENABLED", "1").lower() not in (
    "0",
    "false",
    "no",
    "off",
)
