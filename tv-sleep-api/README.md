# TV Sleep API

Piccolo servizio locale per salvare su SQLite i dati inviati dall'ESP32 del progetto TV Sleep.

Questa cartella fa parte del progetto:

```text
D:\Documenti\Development\TvArduino\tv-sleep-api
```

Copiala sul mini PC/server prima di avviarla.

## Struttura

```text
app.py                  # entrypoint minimale
tv_sleep/config.py      # percorsi e variabili ambiente
tv_sleep/db.py          # SQLite e query
tv_sleep/reports.py     # riepilogo sessione e serie grafico
tv_sleep/server.py      # HTTP server, routing API e static files
templates/dashboard.html
static/app.css
static/app.js
```

## Avvio sul mini PC

Sul tuo PC Windows, copia questa cartella sul server, per esempio con WinSCP oppure SCP:

```powershell
scp -P 2222 -r "D:\Documenti\Development\TvArduino\tv-sleep-api" giovanniguarino@192.168.1.196:/home/giovanniguarino/
```

Poi sul server:

```bash
cd ~/tv-sleep-api
docker compose up -d --build
```

Se il firewall blocca la porta:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8010 proto tcp
```

## URL utili

Dashboard:

```text
http://192.168.1.196:8010/
```

Health check:

```text
http://192.168.1.196:8010/api/health
```

Ultima lettura:

```text
http://192.168.1.196:8010/api/latest
```

Riepilogo sessione recente:

```text
http://192.168.1.196:8010/api/session
```

Serie dati per il grafico:

```text
http://192.168.1.196:8010/api/sleep-series
```

Impostazioni modificabili dalla dashboard:

```text
http://192.168.1.196:8010/api/settings
```

Report sessione:

```text
http://192.168.1.196:8010/api/session-summary
```

Endpoint legacy ancora disponibili per compatibilita:

```text
http://192.168.1.196:8010/api/night
http://192.168.1.196:8010/api/morning-report
```

Calibrazione distanze:

```text
http://192.168.1.196:8010/api/calibration
```

Export CSV letture:

```text
http://192.168.1.196:8010/api/export/readings.csv
```

Export CSV eventi:

```text
http://192.168.1.196:8010/api/export/events.csv
```

Comandi manuali recenti:

```text
http://192.168.1.196:8010/api/commands
```

Export CSV comandi:

```text
http://192.168.1.196:8010/api/export/commands.csv
```

Accodare un comando POWER:

```bash
curl -X POST http://localhost:8010/api/commands \
  -H "Content-Type: application/json" \
  -d '{"command_type":"tv_power","repeat_count":1,"device_id":"camera-tv-esp32","source":"dashboard"}'
```

Annullare un comando pendente:

```bash
curl -X POST http://localhost:8010/api/commands/cancel \
  -H "Content-Type: application/json" \
  -d '{"id":1}'
```

## Firmware ESP32

Lo sketch legge periodicamente le impostazioni dal server:

```text
http://192.168.1.196:8010/api/settings/device
```

Le impostazioni includono anche:

```text
auto_power_enabled=1   # spegnimento automatico attivo
auto_power_enabled=0   # solo monitoraggio, nessun POWER automatico
```

La dashboard mostra questa modalita in alto e nel tab Impostazioni. I comandi
POWER manuali restano disponibili anche quando lo spegnimento automatico e
disattivato.

Le nuove letture inviate dal firmware includono anche `score_reason`, cioe il
motivo leggibile del cambio punteggio, per esempio `+1 stabile e fermo` oppure
`-8 movimento forte`.

Dopo il prossimo upload via USB, lo sketch abilita anche Arduino OTA. Nell'IDE
Arduino dovrebbe comparire una porta di rete con hostname:

```text
camera-tv-esp32
```

Il primo upload con OTA abilitato va comunque fatto via USB. Dopo, quando
l'ESP32 e il PC sono sulla stessa rete, puoi provare gli aggiornamenti via WiFi.

## Home Assistant / MQTT

Per ora l'integrazione piu semplice con Home Assistant e un REST command verso:

```text
POST http://192.168.1.196:8010/api/commands
```

Payload:

```json
{"command_type":"tv_power","repeat_count":1,"device_id":"camera-tv-esp32","source":"home-assistant"}
```

MQTT resta una buona evoluzione se vuoi portare altri sensori o automazioni sul
mini PC: e leggero, bidirezionale e pensato per IoT. In questo progetto pero il
polling HTTP attuale resta piu semplice da debuggare.

## Test manuale

```bash
curl -X POST http://localhost:8010/api/readings \
  -H "Content-Type: application/json" \
  -d '{"device_id":"test","radar_ok":true,"presence":true,"in_bed":true,"dist_raw":70,"dist_filtered":72,"sleep_score":10}'
```

## Database

Il database resta qui:

```text
./data/tv_sleep.db
```
