from .config import REMOTE_PROVIDER
from .broadlink_remote import (
    BroadlinkError,
    broadlink_probe,
    broadlink_status,
    check_learning,
    send_tv_off as send_broadlink_tv_off,
    start_learning,
)


class RemoteControlError(RuntimeError):
    pass


def provider_name():
    return REMOTE_PROVIDER or "none"


def remote_status():
    provider = provider_name()

    if provider == "broadlink":
        return {
            **broadlink_status(),
            "provider": provider,
            "supports_learning": True,
            "fallback": "esp32_ir",
        }

    return {
        "provider": provider,
        "auto_enabled": False,
        "library_ready": True,
        "library_error": None,
        "packet_saved": False,
        "ready": False,
        "supports_learning": False,
        "fallback": "esp32_ir" if provider in ("esp32_ir", "none") else None,
    }


def remote_probe():
    provider = provider_name()

    if provider == "broadlink":
        return {
            **broadlink_probe(),
            "provider": provider,
            "supports_learning": True,
        }

    raise RemoteControlError(f"Remote provider '{provider}' does not support probe")


def remote_start_learning():
    provider = provider_name()

    if provider == "broadlink":
        return {
            **start_learning(),
            "provider": provider,
            "supports_learning": True,
        }

    raise RemoteControlError(f"Remote provider '{provider}' does not support learning")


def remote_check_learning():
    provider = provider_name()

    if provider == "broadlink":
        return {
            **check_learning(),
            "provider": provider,
            "supports_learning": True,
        }

    raise RemoteControlError(f"Remote provider '{provider}' does not support learning")


def remote_send_tv_off(repeat_count=1):
    provider = provider_name()

    if provider == "broadlink":
        return {
            **send_broadlink_tv_off(repeat_count),
            "provider": provider,
        }

    raise RemoteControlError(f"Remote provider '{provider}' cannot send TV OFF")
