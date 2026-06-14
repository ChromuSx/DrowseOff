# TV Sleep Monitor

A DIY project that detects when someone is likely falling asleep while watching
TV, stores the sensor readings locally, and turns the TV off through a remote
control backend.

The current reference setup uses:

- an ESP32 near the bed;
- an LD2410C mmWave presence sensor;
- a local mini PC or home server running Docker;
- a web dashboard with SQLite storage;
- a BroadLink RM Mini3 near the TV for reliable IR output.

The ESP32 does not need to be close to the TV. It only measures presence,
distance, and stability near the bed. The TV OFF command can be handled by a
remote hub such as BroadLink, or by the ESP32 IR transmitter fallback.

## How It Works

```text
LD2410C + ESP32 near the bed
  -> presence and stability readings over Wi-Fi
  -> local API, dashboard, and SQLite database
  -> remote control backend near the TV
  -> TV OFF IR command
```

## Project Structure

```text
sketch_may20a/     ESP32 Arduino firmware
tv-sleep-api/      Python API, web dashboard, and SQLite storage
```

## Local Secrets

The Arduino sketch reads Wi-Fi and server settings from:

```text
sketch_may20a/secrets.h
```

That file is ignored by Git. Create it from the example:

```text
cp sketch_may20a/secrets.example.h sketch_may20a/secrets.h
```

Then set your real Wi-Fi name, Wi-Fi password, device ID, and server URL.

The server reads local deployment settings from:

```text
tv-sleep-api/.env
```

That file is also ignored by Git. Create it from:

```text
tv-sleep-api/.env.example
```

## Dashboard

After starting the server, open:

```text
http://YOUR_SERVER_IP:8010/
```

See `tv-sleep-api/README.md` for Docker startup, API endpoints, and operational
notes.

## Sleep Threshold

The default sleep threshold is `600`. It is the score the firmware must reach
before requesting a TV OFF command. The firmware updates the score roughly once
per second:

- the score rises when the person is in bed and stable;
- strong movement lowers the score;
- leaving the bed or losing the valid bed-range target resets the score.

With the default threshold of `600`, a calm session takes roughly 10 minutes to
reach the automatic TV OFF point. Lower values turn the TV off sooner; higher
values wait longer.

## Remote Control Backends

The first stable backend is BroadLink. The dashboard can learn and replay a TV
OFF IR code through a BroadLink RM Mini device.

The firmware still supports an ESP32 IR transmitter fallback for users who want
a direct IR module instead of a network remote hub. In practice, a hub placed
near the TV is usually more reliable than a weak IR LED near the bed.

## Repository Hygiene

This repository should not contain databases, Wi-Fi credentials, private IP
addresses, learned IR packets, or generated build outputs. Keep those in ignored
local files such as `secrets.h`, `.env`, and `tv-sleep-api/data/`.
