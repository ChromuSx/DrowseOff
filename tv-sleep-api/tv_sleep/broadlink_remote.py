import base64
import os
import time
from pathlib import Path


BROADLINK_HOST = os.environ.get("BROADLINK_HOST", "192.168.1.107")
BROADLINK_PACKET_PATH = Path(
    os.environ.get("BROADLINK_PACKET_PATH", "/data/broadlink_tv_off.b64")
)
BROADLINK_AUTO_ENABLED = os.environ.get("BROADLINK_AUTO_ENABLED", "1") not in (
    "0",
    "false",
    "False",
)
BROADLINK_TIMEOUT = float(os.environ.get("BROADLINK_TIMEOUT", "5"))
BROADLINK_REPEAT_DELAY = float(os.environ.get("BROADLINK_REPEAT_DELAY", "0.35"))


class BroadlinkError(RuntimeError):
    pass


def _load_broadlink():
    try:
        import broadlink
    except ImportError as exc:
        raise BroadlinkError("Libreria broadlink non installata") from exc

    return broadlink


def _device():
    if not BROADLINK_HOST:
        raise BroadlinkError("IP BroadLink non configurato")

    broadlink = _load_broadlink()
    device = broadlink.hello(BROADLINK_HOST, timeout=BROADLINK_TIMEOUT)
    device.auth()
    return device


def _read_packet():
    if not BROADLINK_PACKET_PATH.exists():
        raise BroadlinkError("Codice OFF BroadLink non ancora imparato")

    encoded = BROADLINK_PACKET_PATH.read_text(encoding="ascii").strip()
    if not encoded:
        raise BroadlinkError("Codice OFF BroadLink vuoto")

    return base64.b64decode(encoded)


def broadlink_status():
    try:
        _load_broadlink()
        library_ready = True
        library_error = None
    except BroadlinkError as exc:
        library_ready = False
        library_error = str(exc)

    packet_saved = (
        BROADLINK_PACKET_PATH.exists() and BROADLINK_PACKET_PATH.stat().st_size > 0
    )

    return {
        "host": BROADLINK_HOST,
        "auto_enabled": BROADLINK_AUTO_ENABLED,
        "library_ready": library_ready,
        "library_error": library_error,
        "packet_saved": packet_saved,
        "ready": bool(BROADLINK_HOST and library_ready and packet_saved),
    }


def broadlink_probe():
    device = _device()
    return {
        **broadlink_status(),
        "device": device.__class__.__name__,
        "devtype": hex(getattr(device, "devtype", 0)),
        "connected": True,
    }


def start_learning():
    device = _device()
    device.enter_learning()
    return {
        **broadlink_status(),
        "learning": True,
        "message": "BroadLink in apprendimento",
    }


def check_learning():
    device = _device()
    packet = device.check_data()

    if not packet:
        raise BroadlinkError("Nessun codice IR ricevuto")

    BROADLINK_PACKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    encoded = base64.b64encode(packet).decode("ascii")
    BROADLINK_PACKET_PATH.write_text(encoded, encoding="ascii")

    return {
        **broadlink_status(),
        "saved": True,
        "bytes": len(packet),
    }


def send_tv_off(repeat_count=1):
    repeat_count = max(1, min(int(repeat_count or 1), 5))
    packet = _read_packet()
    device = _device()

    for index in range(repeat_count):
        device.send_data(packet)
        if index < repeat_count - 1:
            time.sleep(BROADLINK_REPEAT_DELAY)

    return {
        **broadlink_status(),
        "sent": True,
        "repeat_count": repeat_count,
    }
