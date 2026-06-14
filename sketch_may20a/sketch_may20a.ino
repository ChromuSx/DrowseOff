#include <Arduino.h>
#include <ld2410.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoOTA.h>
#include <string.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef WIFI_SSID_VALUE
#define WIFI_SSID_VALUE "INSERISCI_NOME_WIFI"
#endif

#ifndef WIFI_PASSWORD_VALUE
#define WIFI_PASSWORD_VALUE "INSERISCI_PASSWORD_WIFI"
#endif

ld2410 radar;

const int RADAR_RX_PIN = 16;
const int RADAR_TX_PIN = 17;
const int IR_LED_PIN = 23;

IRsend irsend(IR_LED_PIN);

const bool INVIA_DATI_SERVER = true;
const char WIFI_SSID[] = WIFI_SSID_VALUE;
const char WIFI_PASSWORD[] = WIFI_PASSWORD_VALUE;
const char DEVICE_ID[] = "camera-tv-esp32";
const char SERVER_READINGS_URL[] = "http://192.168.1.196:8010/api/readings";
const char SERVER_EVENTS_URL[] = "http://192.168.1.196:8010/api/events";
const char SERVER_COMMAND_NEXT_URL[] = "http://192.168.1.196:8010/api/commands/next";
const char SERVER_COMMAND_COMPLETE_URL[] = "http://192.168.1.196:8010/api/commands/complete";
const char SERVER_SETTINGS_URL[] = "http://192.168.1.196:8010/api/settings/device";
const unsigned long INTERVALLO_INVIO_SERVER_MS = 10000;
const unsigned long INTERVALLO_CONTROLLO_COMANDI_MS = 5000;
const unsigned long INTERVALLO_SETTINGS_SERVER_MS = 60000;
const unsigned long INTERVALLO_RECONNECT_WIFI_MS = 30000;

int distanzaMinCm = 40;
int distanzaMaxCm = 120;
int punteggioSpegnimento = 600;
int cambioDistanzaTranquilloCm = 25;
int cambioDistanzaForteCm = 55;
int maxLettureFuoriLetto = 8;
int irRipetizioni = 2;
bool autoSpegnimentoAttivo = true;

const int NUM_LETTURE_DISTANZA = 5;

const int RADAR_MAX_MOVING_GATE = 2;
const int RADAR_MAX_STATIONARY_GATE = 2;
const int RADAR_INACTIVITY_TIMER_S = 3;
const bool CONFIGURA_RADAR_ALL_AVVIO = true;

int punteggioSonno = 0;
bool tvGiaSpenta = false;

int ultimaDistanzaValida = -1;
int lettureFuoriLettoConsecutive = 0;
unsigned long ultimoControllo = 0;
unsigned long ultimoInvioServer = 0;
unsigned long ultimoControlloComandiServer = 0;
unsigned long ultimoControlloSettingsServer = 0;
unsigned long ultimoTentativoWifi = 0;
bool otaConfigurata = false;

int storicoDistanze[NUM_LETTURE_DISTANZA];
int storicoDistanzeCount = 0;
int storicoDistanzeIndex = 0;

bool wifiConfigurato() {
  return strcmp(WIFI_SSID, "INSERISCI_NOME_WIFI") != 0 &&
         strcmp(WIFI_PASSWORD, "INSERISCI_PASSWORD_WIFI") != 0 &&
         strlen(WIFI_SSID) > 0;
}

void configuraOTA() {
  if (otaConfigurata || WiFi.status() != WL_CONNECTED) {
    return;
  }

  ArduinoOTA.setHostname(DEVICE_ID);

  ArduinoOTA.onStart([]() {
    Serial.println("OTA: inizio aggiornamento firmware");
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("OTA: aggiornamento completato");
  });

  ArduinoOTA.onError([](ota_error_t error) {
    Serial.print("OTA: errore ");
    Serial.println(error);
  });

  ArduinoOTA.begin();
  otaConfigurata = true;
  Serial.println("OTA pronto: puoi aggiornare via WiFi dall IDE Arduino");
}

void gestisciOTA() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  configuraOTA();
  ArduinoOTA.handle();
}

void connettiWifi() {
  if (!INVIA_DATI_SERVER || !wifiConfigurato()) {
    Serial.println("WiFi logging non configurato");
    return;
  }

  Serial.print("Connessione WiFi a ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long inizio = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - inizio < 10000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connesso | IP ESP32: ");
    Serial.println(WiFi.localIP());
    configuraOTA();
  } else {
    Serial.println("WiFi non connesso: continuo senza invio dati");
  }
}

void assicuratiWifi() {
  if (!INVIA_DATI_SERVER || !wifiConfigurato()) {
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - ultimoTentativoWifi < INTERVALLO_RECONNECT_WIFI_MS) {
    return;
  }

  ultimoTentativoWifi = millis();
  Serial.println("WiFi disconnesso: nuovo tentativo");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

String boolJson(bool valore) {
  return valore ? "true" : "false";
}

String escapeJson(const String& valore) {
  String risultato = "";

  for (int i = 0; i < valore.length(); i++) {
    char c = valore[i];

    if (c == '\\' || c == '"') {
      risultato += '\\';
    }

    risultato += c;
  }

  return risultato;
}

bool postJson(const char* url, const String& json) {
  if (!INVIA_DATI_SERVER || !wifiConfigurato() || WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  http.setTimeout(2000);

  if (!http.begin(url)) {
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  int statusCode = http.POST(json);
  http.end();

  return statusCode >= 200 && statusCode < 300;
}

bool getJson(const String& url, String& response) {
  if (!INVIA_DATI_SERVER || !wifiConfigurato() || WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  http.setTimeout(2000);

  if (!http.begin(url)) {
    return false;
  }

  int statusCode = http.GET();

  if (statusCode >= 200 && statusCode < 300) {
    response = http.getString();
    http.end();
    return true;
  }

  http.end();
  return false;
}

int estraiCampoIntero(const String& json, const char* nomeCampo) {
  String chiave = "\"" + String(nomeCampo) + "\"";
  int posizioneChiave = json.indexOf(chiave);

  if (posizioneChiave < 0) {
    return -1;
  }

  int posizioneDuePunti = json.indexOf(':', posizioneChiave);

  if (posizioneDuePunti < 0) {
    return -1;
  }

  int inizioNumero = posizioneDuePunti + 1;

  while (inizioNumero < json.length() && json[inizioNumero] == ' ') {
    inizioNumero++;
  }

  int fineNumero = inizioNumero;

  while (fineNumero < json.length() && (isDigit(json[fineNumero]) || json[fineNumero] == '-')) {
    fineNumero++;
  }

  if (fineNumero == inizioNumero) {
    return -1;
  }

  return json.substring(inizioNumero, fineNumero).toInt();
}

int limitaIntero(int valore, int minimo, int massimo) {
  if (valore < minimo) {
    return minimo;
  }

  if (valore > massimo) {
    return massimo;
  }

  return valore;
}

void applicaCampoIntero(const String& json, const char* nomeCampo, int& destinazione, int minimo, int massimo) {
  int valore = estraiCampoIntero(json, nomeCampo);

  if (valore < 0) {
    return;
  }

  destinazione = limitaIntero(valore, minimo, massimo);
}

void caricaImpostazioniServer(bool forza = false) {
  if (!forza && millis() - ultimoControlloSettingsServer < INTERVALLO_SETTINGS_SERVER_MS) {
    return;
  }

  ultimoControlloSettingsServer = millis();

  String response;
  String url = String(SERVER_SETTINGS_URL) + "?device_id=" + String(DEVICE_ID);

  if (!getJson(url, response)) {
    return;
  }

  applicaCampoIntero(response, "sleep_threshold", punteggioSpegnimento, 30, 3600);
  applicaCampoIntero(response, "distance_min_cm", distanzaMinCm, 20, 400);
  applicaCampoIntero(response, "distance_max_cm", distanzaMaxCm, 30, 600);
  applicaCampoIntero(response, "distance_quiet_cm", cambioDistanzaTranquilloCm, 1, 120);
  applicaCampoIntero(response, "distance_strong_cm", cambioDistanzaForteCm, 5, 200);
  applicaCampoIntero(response, "out_of_bed_limit", maxLettureFuoriLetto, 1, 60);
  applicaCampoIntero(response, "ir_repeats", irRipetizioni, 0, 5);

  int autoPower = estraiCampoIntero(response, "auto_power_enabled");
  if (autoPower >= 0) {
    autoSpegnimentoAttivo = autoPower == 1;
  }

  if (distanzaMinCm >= distanzaMaxCm) {
    distanzaMaxCm = distanzaMinCm + 10;
  }

  if (cambioDistanzaTranquilloCm >= cambioDistanzaForteCm) {
    cambioDistanzaForteCm = cambioDistanzaTranquilloCm + 5;
  }
}

void inviaPowerTv(int numeroInvii = 1) {
  numeroInvii = limitaIntero(numeroInvii, 1, 5);

  for (int i = 0; i < numeroInvii; i++) {
    irsend.sendSAMSUNG(0xE0E019E6, 32, irRipetizioni);

    if (i < numeroInvii - 1) {
      delay(250);
    }
  }
}

void completaComandoServer(int commandId, const char* status, int distanzaFiltrata, const char* note) {
  String json = "{";
  json += "\"id\":" + String(commandId);
  json += ",\"status\":\"" + String(status) + "\"";
  json += ",\"sleep_score\":" + String(punteggioSonno);
  json += ",\"dist_filtered\":" + String(distanzaFiltrata);
  json += ",\"note\":\"" + String(note) + "\"";
  json += "}";

  postJson(SERVER_COMMAND_COMPLETE_URL, json);
}

bool controllaComandiServer(int distanzaFiltrata) {
  if (millis() - ultimoControlloComandiServer < INTERVALLO_CONTROLLO_COMANDI_MS) {
    return false;
  }

  ultimoControlloComandiServer = millis();

  String response;
  String url = String(SERVER_COMMAND_NEXT_URL) + "?device_id=" + String(DEVICE_ID);

  if (!getJson(url, response)) {
    return false;
  }

  int commandId = estraiCampoIntero(response, "id");

  if (commandId <= 0 || response.indexOf("tv_power") < 0) {
    return false;
  }

  int repeatCount = estraiCampoIntero(response, "repeat_count");
  if (repeatCount <= 0) {
    repeatCount = 1;
  }

  inviaPowerTv(repeatCount);
  tvGiaSpenta = true;
  completaComandoServer(commandId, "done", distanzaFiltrata, "POWER inviato dall ESP32");

  return true;
}

void inviaLetturaServer(
  bool radarConnesso,
  bool presenza,
  bool personaNelLetto,
  bool movimento,
  bool fermo,
  bool distanzaStabile,
  int energiaMovimento,
  int energiaFermo,
  int distanzaScelta,
  int distanzaFiltrata,
  int cambioDistanza,
  bool tvCommandSent,
  const String& scoreReason
) {
  if (millis() - ultimoInvioServer < INTERVALLO_INVIO_SERVER_MS && !tvCommandSent) {
    return;
  }

  ultimoInvioServer = millis();

  String json = "{";
  json += "\"device_id\":\"" + String(DEVICE_ID) + "\"";
  json += ",\"mode\":\"" + String(autoSpegnimentoAttivo ? "AUTO" : "MONITOR") + "\"";
  json += ",\"threshold\":" + String(punteggioSpegnimento);
  json += ",\"radar_ok\":" + boolJson(radarConnesso);
  json += ",\"presence\":" + boolJson(presenza);
  json += ",\"in_bed\":" + boolJson(personaNelLetto);
  json += ",\"moving\":" + boolJson(movimento);
  json += ",\"still\":" + boolJson(fermo);
  json += ",\"stable\":" + boolJson(distanzaStabile);
  json += ",\"energy_moving\":" + String(energiaMovimento);
  json += ",\"energy_still\":" + String(energiaFermo);
  json += ",\"dist_raw\":" + String(distanzaScelta);
  json += ",\"dist_filtered\":" + String(distanzaFiltrata);
  json += ",\"dist_change\":" + String(cambioDistanza);
  json += ",\"sleep_score\":" + String(punteggioSonno);
  json += ",\"out_of_bed_count\":" + String(lettureFuoriLettoConsecutive);
  json += ",\"tv_command_sent\":" + boolJson(tvCommandSent);
  json += ",\"score_reason\":\"" + escapeJson(scoreReason) + "\"";
  json += "}";

  bool inviato = postJson(SERVER_READINGS_URL, json);

  Serial.print(" | Server lettura: ");
  Serial.print(inviato ? "OK" : "NO");
}

void inviaEventoServer(const char* eventType, int distanzaFiltrata, const char* note) {
  String json = "{";
  json += "\"device_id\":\"" + String(DEVICE_ID) + "\"";
  json += ",\"event_type\":\"" + String(eventType) + "\"";
  json += ",\"sleep_score\":" + String(punteggioSonno);
  json += ",\"dist_filtered\":" + String(distanzaFiltrata);
  json += ",\"note\":\"" + String(note) + "\"";
  json += "}";

  bool inviato = postJson(SERVER_EVENTS_URL, json);

  Serial.print(" | Server evento: ");
  Serial.print(inviato ? "OK" : "NO");
}

void resetFiltroDistanza() {
  storicoDistanzeCount = 0;
  storicoDistanzeIndex = 0;
}

void aggiungiDistanzaAlFiltro(int distanza) {
  storicoDistanze[storicoDistanzeIndex] = distanza;
  storicoDistanzeIndex = (storicoDistanzeIndex + 1) % NUM_LETTURE_DISTANZA;

  if (storicoDistanzeCount < NUM_LETTURE_DISTANZA) {
    storicoDistanzeCount++;
  }
}

int calcolaDistanzaFiltrata() {
  if (storicoDistanzeCount == 0) {
    return -1;
  }

  int valori[NUM_LETTURE_DISTANZA];

  for (int i = 0; i < storicoDistanzeCount; i++) {
    valori[i] = storicoDistanze[i];
  }

  for (int i = 0; i < storicoDistanzeCount - 1; i++) {
    for (int j = i + 1; j < storicoDistanzeCount; j++) {
      if (valori[j] < valori[i]) {
        int temporaneo = valori[i];
        valori[i] = valori[j];
        valori[j] = temporaneo;
      }
    }
  }

  int centro = storicoDistanzeCount / 2;

  if (storicoDistanzeCount % 2 == 1) {
    return valori[centro];
  }

  return (valori[centro - 1] + valori[centro]) / 2;
}

void configuraRadarSeServe() {
  if (!CONFIGURA_RADAR_ALL_AVVIO) {
    return;
  }

  Serial.println("Controllo configurazione LD2410C");

  if (!radar.requestCurrentConfiguration()) {
    Serial.println("Configurazione LD2410C non letta: continuo con i valori attuali");
    return;
  }

  Serial.print("Config attuale radar | Max mov gate: ");
  Serial.print(radar.max_moving_gate);
  Serial.print(" | Max fermo gate: ");
  Serial.print(radar.max_stationary_gate);
  Serial.print(" | Timeout: ");
  Serial.print(radar.sensor_idle_time);
  Serial.println(" s");

  bool configurazioneGiaCorretta =
    radar.max_moving_gate == RADAR_MAX_MOVING_GATE &&
    radar.max_stationary_gate == RADAR_MAX_STATIONARY_GATE &&
    radar.sensor_idle_time == RADAR_INACTIVITY_TIMER_S;

  if (configurazioneGiaCorretta) {
    Serial.println("Configurazione LD2410C gia corretta");
    return;
  }

  Serial.println("Imposto LD2410C su zona corta: circa 1,5 m");

  if (!radar.setMaxValues(RADAR_MAX_MOVING_GATE, RADAR_MAX_STATIONARY_GATE, RADAR_INACTIVITY_TIMER_S)) {
    Serial.println("Errore: configurazione LD2410C non salvata");
    return;
  }

  Serial.println("Configurazione LD2410C salvata, riavvio il sensore");

  if (radar.requestRestart()) {
    delay(1000);
    radar.begin(Serial2);
    Serial.println("LD2410C riavviato");
  } else {
    Serial.println("Attenzione: riavvio LD2410C non riuscito");
  }
}

bool distanzaValida(int d) {
  return d >= distanzaMinCm && d <= distanzaMaxCm;
}

int scegliDistanzaMigliore(int distanzaFermo, int distanzaMovimento) {
  if (distanzaValida(distanzaFermo)) {
    return distanzaFermo;
  }

  if (distanzaValida(distanzaMovimento)) {
    return distanzaMovimento;
  }

  return -1;
}

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("Avvio sistema TV sleep - versione stabilita distanza");

  Serial2.begin(256000, SERIAL_8N1, RADAR_RX_PIN, RADAR_TX_PIN);

  if (radar.begin(Serial2)) {
    Serial.println("LD2410C collegato correttamente");
    configuraRadarSeServe();
  } else {
    Serial.println("Errore: LD2410C non trovato");
  }

  irsend.begin();
  connettiWifi();
  caricaImpostazioniServer(true);

  Serial.print("Spegnimento automatico: ");
  Serial.println(autoSpegnimentoAttivo ? "ATTIVO" : "SOLO MONITORAGGIO");
  Serial.print("Soglia spegnimento: ");
  Serial.print(punteggioSpegnimento);
  Serial.println(" secondi circa");

  Serial.println("Sistema pronto");
}

void loop() {
  radar.read();
  assicuratiWifi();
  gestisciOTA();

  if (millis() - ultimoControllo < 1000) {
    return;
  }

  ultimoControllo = millis();
  caricaImpostazioniServer();

  bool radarConnesso = radar.isConnected();
  bool presenza = radarConnesso && radar.presenceDetected();
  bool movimento = radarConnesso && radar.movingTargetDetected();
  bool fermo = radarConnesso && radar.stationaryTargetDetected();

  int energiaMovimento = radarConnesso ? radar.movingTargetEnergy() : 0;
  int energiaFermo = radarConnesso ? radar.stationaryTargetEnergy() : 0;

  int distanzaMovimento = radarConnesso ? radar.movingTargetDistance() : 0;
  int distanzaFermo = radarConnesso ? radar.stationaryTargetDistance() : 0;

  int distanzaScelta = scegliDistanzaMigliore(distanzaFermo, distanzaMovimento);

  bool personaNelLetto = presenza && distanzaScelta != -1;
  int distanzaFiltrata = -1;

  if (personaNelLetto) {
    aggiungiDistanzaAlFiltro(distanzaScelta);
    distanzaFiltrata = calcolaDistanzaFiltrata();
  }

  int distanzaPerLogica = distanzaFiltrata != -1 ? distanzaFiltrata : distanzaScelta;

  int cambioDistanza = 0;
  bool distanzaStabile = false;
  bool movimentoForte = false;
  bool tvCommandSentThisLoop = false;
  bool comandoDashboardThisLoop = false;
  bool comandoAutomaticoThisLoop = false;
  String motivoPunteggio = "";

  if (personaNelLetto && ultimaDistanzaValida != -1) {
    cambioDistanza = abs(distanzaPerLogica - ultimaDistanzaValida);

    distanzaStabile = cambioDistanza <= cambioDistanzaTranquilloCm;
    movimentoForte = cambioDistanza >= cambioDistanzaForteCm;
  }

  if (!personaNelLetto) {
    lettureFuoriLettoConsecutive++;

    if (lettureFuoriLettoConsecutive >= maxLettureFuoriLetto) {
      punteggioSonno = 0;
      ultimaDistanzaValida = -1;
      resetFiltroDistanza();
      tvGiaSpenta = false;
      motivoPunteggio = "reset: fuori dal letto";
    } else {
      punteggioSonno -= 1;
      motivoPunteggio = "-1 fuori range letto";
    }
  } else {
    lettureFuoriLettoConsecutive = 0;

    if (ultimaDistanzaValida == -1) {
      ultimaDistanzaValida = distanzaPerLogica;
    }

    if (movimentoForte) {
      punteggioSonno -= 8;
      motivoPunteggio = "-8 movimento forte";
    } else if (distanzaStabile && fermo) {
      punteggioSonno += 1;
      motivoPunteggio = "+1 stabile e fermo";
    } else if (distanzaStabile) {
      punteggioSonno += 1;
      motivoPunteggio = "+1 distanza stabile";
    } else {
      punteggioSonno -= 1;
      motivoPunteggio = "-1 distanza instabile";
    }

    ultimaDistanzaValida = distanzaPerLogica;
  }

  if (punteggioSonno < 0) {
    punteggioSonno = 0;
  }

  if (punteggioSonno > punteggioSpegnimento) {
    punteggioSonno = punteggioSpegnimento;
  }

  if (controllaComandiServer(distanzaFiltrata)) {
    tvCommandSentThisLoop = true;
    comandoDashboardThisLoop = true;
  }

  Serial.print("Radar: ");
  Serial.print(radarConnesso ? "OK" : "NO");

  Serial.print(" | Presenza: ");
  Serial.print(presenza ? "SI" : "NO");

  Serial.print(" | Nel letto: ");
  Serial.print(personaNelLetto ? "SI" : "NO");

  Serial.print(" | Fuori letto: ");
  Serial.print(lettureFuoriLettoConsecutive);
  Serial.print("/");
  Serial.print(maxLettureFuoriLetto);

  Serial.print(" | Mov: ");
  Serial.print(movimento ? "SI" : "NO");

  Serial.print(" | E mov: ");
  Serial.print(energiaMovimento);

  Serial.print(" | Fermo: ");
  Serial.print(fermo ? "SI" : "NO");

  Serial.print(" | E fermo: ");
  Serial.print(energiaFermo);

  Serial.print(" | Dist raw: ");
  Serial.print(distanzaScelta);

  Serial.print(" | Dist filtrata: ");
  Serial.print(distanzaFiltrata);

  Serial.print(" | Cambio dist: ");
  Serial.print(cambioDistanza);

  Serial.print(" | Stabile: ");
  Serial.print(distanzaStabile ? "SI" : "NO");

  Serial.print(" | Punteggio sonno: ");
  Serial.print(punteggioSonno);

  Serial.print(" | Motivo: ");
  Serial.print(motivoPunteggio);

  if (comandoDashboardThisLoop) {
    Serial.print(" | POWER DASHBOARD");
  }

  if (punteggioSonno >= punteggioSpegnimento && !tvGiaSpenta && autoSpegnimentoAttivo) {
    Serial.print(" | SPENGO TV");
    inviaPowerTv(1);
    tvGiaSpenta = true;
    tvCommandSentThisLoop = true;
    comandoAutomaticoThisLoop = true;
  } else if (punteggioSonno >= punteggioSpegnimento && !autoSpegnimentoAttivo) {
    Serial.print(" | SOGLIA RAGGIUNTA - SOLO MONITORAGGIO");
  }

  inviaLetturaServer(
    radarConnesso,
    presenza,
    personaNelLetto,
    movimento,
    fermo,
    distanzaStabile,
    energiaMovimento,
    energiaFermo,
    distanzaScelta,
    distanzaFiltrata,
    cambioDistanza,
    tvCommandSentThisLoop,
    motivoPunteggio
  );

  if (comandoAutomaticoThisLoop) {
    inviaEventoServer("tv_power_off_attempt", distanzaFiltrata, "Soglia sonno raggiunta");
  }

  Serial.println();
}
