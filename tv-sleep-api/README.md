# TV Sleep API

Servizio locale per il progetto TV Sleep. Salva su SQLite i dati inviati
dall'ESP32, mostra la dashboard e comanda il BroadLink RM Mini3 per spegnere la
TV.

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
tv_sleep/broadlink_remote.py  # invio e apprendimento codici BroadLink
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

Stato BroadLink:

```text
http://192.168.1.196:8010/api/broadlink/status
```

Probe BroadLink:

```text
http://192.168.1.196:8010/api/broadlink/probe
```

Inviare OFF via BroadLink:

```bash
curl -X POST http://localhost:8010/api/broadlink/send-off \
  -H "Content-Type: application/json" \
  -d '{"repeat_count":1,"source":"manuale"}'
```

Accodare un comando di spegnimento TV all'ESP32, solo fallback storico:

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
auto_power_enabled=0   # solo monitoraggio, nessuno spegnimento automatico
sleep_threshold=600    # circa 10 minuti di stabilita in condizioni tranquille
```

La dashboard mostra questa modalita in alto e nel tab Impostazioni. I comandi
manuali di spegnimento TV restano disponibili anche quando lo spegnimento
automatico e disattivato.

Il punteggio sonno sale circa una volta al secondo quando il sensore vede una
persona stabile nel letto. Movimenti forti lo fanno scendere e l'uscita dal
letto lo azzera. La soglia `600` quindi equivale indicativamente a 10 minuti di
stabilita, non a un timer rigido.

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

## BroadLink

Il BroadLink RM Mini3 e configurato in `docker-compose.yml`:

```text
BROADLINK_HOST=192.168.1.107
BROADLINK_PACKET_PATH=/data/broadlink_tv_off.b64
BROADLINK_AUTO_ENABLED=1
```

Il file `broadlink_tv_off.b64` contiene il codice IR OFF imparato dalla
dashboard. Non va committato: resta nel volume `./data` insieme al database.

Flusso di apprendimento dalla dashboard:

1. Vai su `Comandi TV`.
2. Premi `Avvia apprendimento`.
3. Manda il comando OFF verso il BroadLink.
4. Premi `Salva codice OFF`.

Quando `packet_saved=true` e `ready=true`, il bottone `Spegni TV` usa BroadLink.
Anche lo spegnimento automatico usa BroadLink quando l'ESP32 invia l'evento di
soglia raggiunta.

## Home Assistant / MQTT

Per ora l'integrazione piu semplice con Home Assistant e un REST command verso:

```text
POST http://192.168.1.196:8010/api/broadlink/send-off
```

Payload:

```json
{"repeat_count":1,"source":"home-assistant"}
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
