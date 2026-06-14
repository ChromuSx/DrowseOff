import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

DB_PATH = os.environ.get("TV_SLEEP_DB", "/data/tv_sleep.db")
HOST = os.environ.get("TV_SLEEP_HOST", "0.0.0.0")
PORT = int(os.environ.get("TV_SLEEP_PORT", "8010"))
