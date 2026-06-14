# TV Sleep API

Local API and dashboard for TV Sleep Monitor. It receives ESP32 sensor readings,
stores them in SQLite, renders the web dashboard, and can send a TV OFF command
through a configurable remote backend.

## Structure

```text
app.py                         # minimal entrypoint
tv_sleep/config.py             # paths and environment variables
tv_sleep/db.py                 # SQLite schema and queries
tv_sleep/reports.py            # session summaries and chart series
tv_sleep/remote_control.py     # provider-neutral remote control facade
tv_sleep/broadlink_remote.py   # BroadLink implementation
tv_sleep/server.py             # HTTP server, API routing, static files
templates/dashboard.html
static/app.css
static/app.js
```

## Configuration

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

Then adjust the values for your home network:

```env
TZ=UTC
TV_SLEEP_HOST_PORT=8010
TV_SLEEP_DB=/data/tv_sleep.db
TV_SLEEP_API_TOKEN=
DEFAULT_SENSOR_DEVICE_ID=tv-sleep-sensor

REMOTE_PROVIDER=broadlink
REMOTE_AUTO_ENABLED=1
BROADLINK_HOST=192.168.1.100
BROADLINK_PACKET_PATH=/data/broadlink_tv_off.b64
```

Do not commit `.env`, database files, or learned IR packet files.

`TV_SLEEP_API_TOKEN` is optional for trusted LAN-only setups. If it is set, every
API endpoint except `/api/health` requires the token through either:

```text
X-TV-Sleep-Token: YOUR_TOKEN
Authorization: Bearer YOUR_TOKEN
```

Set the same value in the firmware `API_TOKEN_VALUE`. In the dashboard, use the
API Token button to save it in that browser. Do not expose this service directly
to the public internet without a reverse proxy, TLS, and an access policy you
trust.

## Docker Startup

From this directory:

```bash
docker compose up -d --build
```

If your server firewall blocks the dashboard port, allow access from your local
network. Example for UFW:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8010 proto tcp
```

Open the dashboard at:

```text
http://YOUR_SERVER_IP:8010/
```

## Main API Endpoints

```text
GET  /api/health
GET  /api/latest
GET  /api/summary
GET  /api/session
GET  /api/session-summary
GET  /api/sleep-series
GET  /api/calibration
GET  /api/settings
POST /api/settings
GET  /api/readings
POST /api/readings
GET  /api/events
POST /api/events
GET  /api/commands
POST /api/commands
POST /api/commands/cancel
GET  /api/export/readings.csv
GET  /api/export/events.csv
GET  /api/export/commands.csv
```

## Remote Control API

Provider-neutral endpoints:

```text
GET  /api/remote/status
GET  /api/remote/probe
POST /api/remote/send-off
POST /api/remote/learn/start
POST /api/remote/learn/check
```

Send TV OFF through the configured remote provider:

```bash
curl -X POST http://localhost:8010/api/remote/send-off \
  -H "Content-Type: application/json" \
  -H "X-TV-Sleep-Token: YOUR_TOKEN" \
  -d '{"repeat_count":1,"source":"manual"}'
```

Queue a TV OFF command for the ESP32 IR fallback:

```bash
curl -X POST http://localhost:8010/api/commands \
  -H "Content-Type: application/json" \
  -H "X-TV-Sleep-Token: YOUR_TOKEN" \
  -d '{"command_type":"tv_power","repeat_count":1,"source":"dashboard"}'
```

## ESP32 Firmware

The firmware periodically reads device settings from:

```text
http://YOUR_SERVER_IP:8010/api/settings/device
```

Important settings:

```text
auto_power_enabled=1   # automatic TV OFF enabled
auto_power_enabled=0   # monitoring only
sleep_threshold=600    # roughly 10 calm minutes with the default scoring
esp32_ir_auto_enabled=0 # ESP32 does not auto-send direct IR
esp32_ir_auto_enabled=1 # ESP32 auto-sends direct IR on threshold
```

The dashboard exposes these settings in the Settings tab. Manual TV OFF commands
remain available even when automatic TV OFF is disabled.

Keep `esp32_ir_auto_enabled=0` when using a remote hub such as BroadLink. Enable
it only if the ESP32 has a working IR transmitter that should act as the
automatic TV OFF device.

The firmware also sends `score_reason`, a human-readable reason for score
changes, such as `+1 stable and still` or `-8 strong movement`.

Arduino OTA is enabled after the first USB upload. OTA availability depends on
your network and Arduino IDE setup.

## BroadLink Workflow

Set these values in `.env`:

```env
REMOTE_PROVIDER=broadlink
REMOTE_AUTO_ENABLED=1
BROADLINK_HOST=192.168.1.100
BROADLINK_PACKET_PATH=/data/broadlink_tv_off.b64
```

Learning flow from the dashboard:

1. Open the TV Commands tab.
2. Press Start Learning.
3. Send the TV OFF command toward the BroadLink device.
4. Press Save OFF Code.

When `packet_saved=true` and `ready=true`, the dashboard TV OFF button uses the
remote provider. Automatic TV OFF also uses the remote provider when the ESP32
reports that the sleep threshold has been reached.

The threshold event itself is stored as `tv_power_off_attempt`. A successful
remote provider send is stored separately as `tv_off_remote_auto` or
`tv_off_remote_manual`. A successful direct ESP32 automatic IR send is stored as
`tv_off_esp32_auto`. Remote failures are stored as `tv_off_remote_failed`.

## Home Assistant

The simplest Home Assistant integration is a REST command:

```text
POST http://YOUR_SERVER_IP:8010/api/remote/send-off
Header: X-TV-Sleep-Token: YOUR_TOKEN
```

Payload:

```json
{"repeat_count":1,"source":"home-assistant"}
```

MQTT is a useful future option for larger IoT setups, but the current HTTP flow
is intentionally simple to debug.

## Manual Test

```bash
curl -X POST http://localhost:8010/api/readings \
  -H "Content-Type: application/json" \
  -H "X-TV-Sleep-Token: YOUR_TOKEN" \
  -d '{"device_id":"test","radar_ok":true,"presence":true,"in_bed":true,"dist_raw":70,"dist_filtered":72,"sleep_score":10}'
```

## Database

The default Docker database path is:

```text
./data/tv_sleep.db
```
