# Repository Notes

## Arduino Firmware Workflow

- The user compiles and uploads ESP32 firmware manually from Arduino IDE.
- Do not run `arduino-cli compile`, `arduino-cli upload`, or other Arduino firmware build/upload commands unless the user explicitly asks for that in the current turn.
- After firmware edits, use lightweight static/text checks only and ask the user to compile/upload from Arduino IDE.

## Public Project Hygiene

- Keep public-facing code, UI text, and documentation in English.
- Do not print or edit local secret files such as `firmware/*/secrets.h` or `tv-sleep-api/.env`; use the matching example files for documentation and defaults.
- Do not add personal Wi-Fi names, passwords, local IP addresses, or user-specific deployment details to tracked files.
