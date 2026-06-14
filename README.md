# DrowseOff

<div align="center">
  <img src="tv-sleep-api/static/brand/drowseoff-logo.png" alt="DrowseOff" width="220">
</div>

<p align="center">
  <img src="https://img.shields.io/badge/ESP32-Arduino-00979D?style=for-the-badge&logo=espressif&logoColor=white" alt="ESP32 Arduino">
  <img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.12+">
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker ready">
  <img src="https://img.shields.io/badge/SQLite-local-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite local">
  <img src="https://img.shields.io/badge/Self--hosted-local--first-2F855A?style=for-the-badge" alt="Self-hosted local-first">
</p>

<p align="center">
  <a href="https://github.com/sponsors/ChromuSx"><img src="https://img.shields.io/badge/Sponsor-GitHub-EA4AAA?style=for-the-badge&logo=github-sponsors&logoColor=white" alt="GitHub Sponsors"></a>
  <a href="https://ko-fi.com/chromus"><img src="https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
  <a href="https://buymeacoffee.com/chromus"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>
  <a href="https://www.paypal.com/paypalme/giovanniguarino1999"><img src="https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal"></a>
</p>

<p align="center">
  <strong>A self-hosted ESP32 sleep monitor that detects when someone is likely falling asleep while watching TV, records the data locally, and turns the TV off through a remote-control backend.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> |
  <a href="#how-it-works">How It Works</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#configuration">Configuration</a> |
  <a href="#remote-control-options">Remote Control</a>
</p>

## Features

- **Bedside sleep scoring** - Uses an ESP32 and LD2410C mmWave radar to track presence, in-bed range, movement, distance stability, and a configurable sleep score.
- **Local monitoring dashboard** - Shows live readings, historical sessions, command status, active alerts, calibration tools, light/dark theme selection, and guided API-token setup.
- **Self-hosted storage** - Runs on a local mini PC, NAS, or home server with Docker and SQLite. Data stays on your network by default.
- **Provider-neutral TV control** - Sends TV OFF through a remote backend near the TV. BroadLink RM Mini is the reference backend; direct ESP32 IR remains available as a fallback.
- **Configurable automation** - Tune sleep threshold, bed distance range, automatic power policy, ESP32 IR fallback, and device filtering from the dashboard/API.
- **Public-project hygiene** - Local secrets, databases, learned IR packets, and generated build outputs are ignored by Git.

## Reference Setup

- ESP32 development board near the bed.
- LD2410C mmWave presence sensor connected to the ESP32.
- Local server running Docker, such as a mini PC, NAS, Raspberry Pi, or always-on desktop.
- Remote-control backend near the TV, such as a BroadLink RM Mini.
- Optional direct IR transmitter connected to the ESP32 for users who prefer a hardware fallback.

The ESP32 does not need to be close to the TV. Its main job is to measure the person near the bed and report readings over Wi-Fi. The actual TV OFF command can be handled by a remote hub placed near the TV, which is usually more reliable than a weak IR LED across the room.

## How It Works

```text
LD2410C + ESP32 near the bed
  -> Wi-Fi readings with presence, distance, movement, and sleep score
  -> DrowseOff API and SQLite database on your local server
  -> web dashboard for monitoring, settings, and manual commands
  -> remote-control backend near the TV
  -> TV OFF command
```

## Project Structure

```text
firmware/esp32_sleep_sensor/   ESP32 Arduino firmware
tv-sleep-api/                  Python API, dashboard, remote backends, SQLite storage
tv-sleep-api/static/brand/     DrowseOff logo and app icons
```

## Quick Start

### 1. Start the local server

```bash
git clone https://github.com/ChromuSx/DrowseOff.git
cd DrowseOff
cd tv-sleep-api
cp .env.example .env
```

Edit `.env` and set at least:

```env
DROWSEOFF_API_TOKEN=replace-with-a-long-random-token
DROWSEOFF_REMOTE_PROVIDER=broadlink
BROADLINK_HOST=YOUR_BROADLINK_IP
```

Then start the API and dashboard:

```bash
docker compose up -d --build
```

Open:

```text
http://YOUR_SERVER_IP:8010/
```

The dashboard will ask for the API token and store it in that browser.

### 2. Configure the ESP32 firmware

Create a local firmware secrets file:

```bash
cd ..
cp firmware/esp32_sleep_sensor/secrets.example.h firmware/esp32_sleep_sensor/secrets.h
```

Set your Wi-Fi, server URL, device ID, and the same API token used by the server:

```cpp
#define WIFI_SSID_VALUE "YOUR_WIFI_NAME"
#define WIFI_PASSWORD_VALUE "YOUR_WIFI_PASSWORD"
#define DEVICE_ID_VALUE "drowseoff-sensor"
#define SERVER_BASE_URL_VALUE "http://YOUR_SERVER_IP:8010"
#define API_TOKEN_VALUE "replace-with-the-same-token"
```

Open `firmware/esp32_sleep_sensor/esp32_sleep_sensor.ino` in Arduino IDE, select your ESP32 board and port, then upload it.

### 3. Learn a TV OFF command

If you use BroadLink:

1. Open the dashboard.
2. Go to the TV Commands area.
3. Start learning.
4. Press the OFF button on the original TV remote toward the BroadLink device.
5. Save the learned OFF code.
6. Test `Send TV OFF` from the dashboard.

## Configuration

The server reads local deployment settings from `tv-sleep-api/.env`. That file is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `DROWSEOFF_API_TOKEN` | Shared API token for the firmware, dashboard, and integrations. Recommended for normal use. |
| `DROWSEOFF_ALLOW_UNAUTHENTICATED_API` | Set to `1` only for trusted LAN experiments without authentication. |
| `DROWSEOFF_HOST_PORT` | Host port exposed by Docker. Defaults to `8010`. |
| `DROWSEOFF_DB` | SQLite path inside the container. Defaults to `/data/drowseoff.db`. |
| `DROWSEOFF_DEFAULT_SENSOR_DEVICE_ID` | Default dashboard device filter. |
| `DROWSEOFF_REMOTE_PROVIDER` | Remote backend provider. `broadlink` is currently implemented. |
| `DROWSEOFF_REMOTE_AUTO_ENABLED` | Enables automatic remote-provider sends when the sleep threshold is reached. |
| `BROADLINK_HOST` | BroadLink device IP or hostname. |
| `BROADLINK_PACKET_PATH` | Saved learned TV OFF packet path. |
| `BROADLINK_STATUS_PROBE_INTERVAL` | Remote status probe cache duration in seconds. |

The firmware reads local Wi-Fi and server settings from `firmware/esp32_sleep_sensor/secrets.h`. That file is also ignored by Git.

## Sleep Threshold

The default sleep threshold is `600`. The firmware updates the score roughly once per second:

- the score rises when the person is in bed and stable;
- strong movement lowers the score;
- leaving the valid bed range resets the score.

With the default threshold, a calm session takes roughly 10 minutes to reach the automatic TV OFF point. Lower values turn the TV off sooner; higher values wait longer.

## Radar Range

When `CONFIGURE_RADAR_ON_BOOT_VALUE` is enabled, the firmware configures the LD2410C detection range from the current bed max distance setting. This helps small bedroom setups avoid detecting the whole room.

If you change `distance_max_cm` significantly from the dashboard, restart the ESP32 so the LD2410C hardware range matches the new placement.

## Remote Control Options

### BroadLink backend

BroadLink is the reference backend. It is useful when the ESP32 sensor is near the bed but the IR emitter must be close to the TV.

Provider-neutral endpoints:

```text
GET  /api/remote/status
GET  /api/remote/probe
POST /api/remote/send-off
POST /api/remote/learn/start
POST /api/remote/learn/check
```

### ESP32 IR fallback

The firmware still supports a direct ESP32 IR transmitter fallback. Keep `esp32_ir_auto_enabled=0` when using a remote hub such as BroadLink. Enable it only when a working IR transmitter is connected to the ESP32 and aimed at the TV.

## API and Data

The dashboard and API can be scoped by `device_id`, so one server can store multiple sensors while still letting each user focus on one room.

Main data exports:

```text
GET /api/export/readings.csv
GET /api/export/events.csv
GET /api/export/commands.csv
```

See [`tv-sleep-api/README.md`](tv-sleep-api/README.md) for full API endpoints, Docker notes, Home Assistant examples, and manual curl tests.

## Security and Privacy

- Keep the service on a trusted local network unless you add a reverse proxy, TLS, and an access policy you trust.
- Set `DROWSEOFF_API_TOKEN` and copy the same value into firmware `API_TOKEN_VALUE`.
- Do not commit `.env`, `secrets.h`, database files, learned IR packets, or generated build outputs.
- Arduino OTA is disabled by default. Enable it only after setting a local `OTA_PASSWORD_VALUE`.

## Limitations

- DrowseOff is a home automation project, not a medical or safety device.
- mmWave placement matters. Reflections, room geometry, and bed position can affect readings.
- TV OFF reliability depends on the remote backend position and signal strength.
- The default algorithm is intentionally conservative and should be tuned per room.

## Roadmap Ideas

- Additional remote providers, such as SwitchBot Hub or MQTT-based remotes.
- Home Assistant discovery helpers.
- More calibration visualizations for LD2410C placement and sensitivity.
- Optional notification hooks for failed remote commands.
- Multi-room dashboard presets.

## Contributing

Issues, ideas, and pull requests are welcome. Please keep public-facing code, UI text, and documentation in English, and avoid committing local network details or secrets.
