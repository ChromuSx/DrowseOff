# TV Sleep Monitor

Progetto DIY per rilevare quando una persona si addormenta davanti alla TV e
spegnere la TV Samsung tramite un ESP32, un sensore radar LD2410C e un
trasmettitore IR.

Il progetto include anche una dashboard locale sul mini PC per vedere letture,
calibrazione, comandi TV, report notturno e impostazioni.

## Struttura

```text
sketch_may20a/     Firmware ESP32 Arduino
tv-sleep-api/      Server Python + dashboard web + SQLite
```

## Segreti locali

Lo sketch Arduino legge le credenziali Wi-Fi da:

```text
sketch_may20a/secrets.h
```

Quel file e ignorato da Git. Per creare una nuova configurazione:

```text
cp sketch_may20a/secrets.example.h sketch_may20a/secrets.h
```

Poi modifica `secrets.h` con SSID e password reali.

## Dashboard

Sul mini PC la dashboard gira su:

```text
http://192.168.1.196:8010/
```

Vedi `tv-sleep-api/README.md` per avvio Docker, API e note operative.

## Componenti principali

- ESP32 NodeMCU
- Sensore presenza LD2410C
- Modulo trasmettitore IR 38 kHz
- Mini PC con Docker per dashboard e database

## Note

Il repository non contiene database, credenziali Wi-Fi o file generati. Il primo
upload del firmware va fatto via USB; dopo, lo sketch abilita anche Arduino OTA.
