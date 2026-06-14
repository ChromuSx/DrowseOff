# TV Sleep Monitor

Progetto DIY per rilevare quando una persona si addormenta davanti alla TV e
spegnere la TV Samsung tramite un ESP32, un sensore radar LD2410C, un mini PC
locale e un BroadLink RM Mini3.

Il progetto include anche una dashboard locale sul mini PC per vedere letture,
calibrazione, comandi TV, sessioni recenti e impostazioni.

## Come funziona

```text
LD2410C + ESP32 vicino al letto
  -> letture presenza/stabilita via Wi-Fi
  -> mini PC con dashboard e database SQLite
  -> BroadLink RM Mini3 vicino alla TV
  -> comando IR OFF TV
```

L'ESP32 non deve piu essere vicino alla TV: rileva solo presenza, distanza e
stabilita nel letto. Lo spegnimento IR affidabile viene fatto dal BroadLink,
posizionato vicino alla TV.

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
- Mini PC con Docker per dashboard e database
- BroadLink RM Mini3 collegato al Wi-Fi e posizionato vicino alla TV

Il vecchio modulo trasmettitore IR 38 kHz puo restare come backup software, ma
non e piu necessario nell'installazione finale.

## Soglia spegnimento

La soglia di default e `600`. Rappresenta il punteggio sonno da raggiungere
prima di comandare lo spegnimento. Il firmware aggiorna il punteggio circa una
volta al secondo:

- se sei nel letto e stabile, il punteggio sale;
- se ti muovi molto, scende;
- se esci dal letto o il sensore perde la presenza, si azzera.

Con soglia `600`, in condizioni tranquille servono circa 10 minuti di stabilita.
Valori piu bassi spengono prima, valori piu alti aspettano di piu.

## Note

Il repository non contiene database, credenziali Wi-Fi o file generati. Il primo
upload del firmware va fatto via USB; dopo, lo sketch abilita anche Arduino OTA.
