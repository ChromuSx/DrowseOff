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
#define WIFI_SSID_VALUE "YOUR_WIFI_NAME"
#endif

#ifndef WIFI_PASSWORD_VALUE
#define WIFI_PASSWORD_VALUE "YOUR_WIFI_PASSWORD"
#endif

#ifndef DEVICE_ID_VALUE
#define DEVICE_ID_VALUE "tv-sleep-sensor"
#endif

#ifndef SERVER_BASE_URL_VALUE
#define SERVER_BASE_URL_VALUE "http://YOUR_SERVER_IP:8010"
#endif

ld2410 radar;

const int RADAR_RX_PIN = 16;
const int RADAR_TX_PIN = 17;
const int IR_LED_PIN = 23;

IRsend irsend(IR_LED_PIN);

const bool SEND_DATA_TO_SERVER = true;
const char WIFI_SSID[] = WIFI_SSID_VALUE;
const char WIFI_PASSWORD[] = WIFI_PASSWORD_VALUE;
const char DEVICE_ID[] = DEVICE_ID_VALUE;
const char SERVER_BASE_URL[] = SERVER_BASE_URL_VALUE;
const unsigned long SERVER_UPLOAD_INTERVAL_MS = 10000;
const unsigned long COMMAND_CHECK_INTERVAL_MS = 5000;
const unsigned long SETTINGS_SYNC_INTERVAL_MS = 60000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 30000;

int bedMinDistanceCm = 40;
int bedMaxDistanceCm = 120;
int sleepThreshold = 600;
int quietDistanceChangeCm = 25;
int strongDistanceChangeCm = 55;
int maxOutOfBedReadings = 8;
int irRepeats = 2;
bool autoPowerEnabled = true;

const int DISTANCE_SAMPLE_COUNT = 5;

const int RADAR_MAX_MOVING_GATE = 2;
const int RADAR_MAX_STATIONARY_GATE = 2;
const int RADAR_INACTIVITY_TIMER_S = 3;
const bool CONFIGURE_RADAR_ON_BOOT = true;

int sleepScore = 0;
bool tvAlreadyOff = false;

int lastValidDistance = -1;
int consecutiveOutOfBedReadings = 0;
unsigned long lastLoopCheck = 0;
unsigned long lastServerUpload = 0;
unsigned long lastCommandCheck = 0;
unsigned long lastSettingsSync = 0;
unsigned long lastWifiRetry = 0;
bool otaConfigured = false;

int distanceHistory[DISTANCE_SAMPLE_COUNT];
int distanceHistoryCount = 0;
int distanceHistoryIndex = 0;

bool wifiConfigured() {
  return strcmp(WIFI_SSID, "YOUR_WIFI_NAME") != 0 && strcmp(WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") != 0 && strlen(WIFI_SSID) > 0;
}

bool serverConfigured() {
  return strcmp(SERVER_BASE_URL, "http://YOUR_SERVER_IP:8010") != 0 && strlen(SERVER_BASE_URL) > 0;
}

String serverUrl(const char* path) {
  String base = String(SERVER_BASE_URL);

  if (base.endsWith("/")) {
    base.remove(base.length() - 1);
  }

  return base + path;
}

void setupOTA() {
  if (otaConfigured || WiFi.status() != WL_CONNECTED) {
    return;
  }

  ArduinoOTA.setHostname(DEVICE_ID);

  ArduinoOTA.onStart([]() {
    Serial.println("OTA: firmware update started");
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("OTA: update completed");
  });

  ArduinoOTA.onError([](ota_error_t error) {
    Serial.print("OTA: error ");
    Serial.println(error);
  });

  ArduinoOTA.begin();
  otaConfigured = true;
  Serial.println("OTA ready: you can update over Wi-Fi from the Arduino IDE");
}

void handleOTA() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  setupOTA();
  ArduinoOTA.handle();
}

void connectWifi() {
  if (!SEND_DATA_TO_SERVER || !wifiConfigured()) {
    Serial.println("Wi-Fi logging is not configured");
    return;
  }

  Serial.print("Connecting Wi-Fi to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startMs = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 10000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected | ESP32 IP: ");
    Serial.println(WiFi.localIP());
    setupOTA();
  } else {
    Serial.println("Wi-Fi not connected: continuing without data upload");
  }
}

void ensureWifi() {
  if (!SEND_DATA_TO_SERVER || !wifiConfigured()) {
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - lastWifiRetry < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }

  lastWifiRetry = millis();
  Serial.println("Wi-Fi disconnected: retrying");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

String boolJson(bool value) {
  return value ? "true" : "false";
}

String escapeJson(const String& value) {
  String result = "";

  for (int i = 0; i < value.length(); i++) {
    char c = value[i];

    if (c == '\\' || c == '"') {
      result += '\\';
    }

    result += c;
  }

  return result;
}

bool postJson(const String& url, const String& json) {
  if (!SEND_DATA_TO_SERVER || !wifiConfigured() || !serverConfigured() || WiFi.status() != WL_CONNECTED) {
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
  if (!SEND_DATA_TO_SERVER || !wifiConfigured() || !serverConfigured() || WiFi.status() != WL_CONNECTED) {
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

int extractIntField(const String& json, const char* fieldName) {
  String key = "\"" + String(fieldName) + "\"";
  int keyPosition = json.indexOf(key);

  if (keyPosition < 0) {
    return -1;
  }

  int colonPosition = json.indexOf(':', keyPosition);

  if (colonPosition < 0) {
    return -1;
  }

  int numberStart = colonPosition + 1;

  while (numberStart < json.length() && json[numberStart] == ' ') {
    numberStart++;
  }

  int numberEnd = numberStart;

  while (numberEnd < json.length() && (isDigit(json[numberEnd]) || json[numberEnd] == '-')) {
    numberEnd++;
  }

  if (numberEnd == numberStart) {
    return -1;
  }

  return json.substring(numberStart, numberEnd).toInt();
}

int clampInt(int value, int minimum, int maximum) {
  if (value < minimum) {
    return minimum;
  }

  if (value > maximum) {
    return maximum;
  }

  return value;
}

void applyIntField(const String& json, const char* fieldName, int& destination, int minimum, int maximum) {
  int value = extractIntField(json, fieldName);

  if (value < 0) {
    return;
  }

  destination = clampInt(value, minimum, maximum);
}

void loadServerSettings(bool force = false) {
  if (!force && millis() - lastSettingsSync < SETTINGS_SYNC_INTERVAL_MS) {
    return;
  }

  lastSettingsSync = millis();

  String response;
  String url = serverUrl("/api/settings/device") + "?device_id=" + String(DEVICE_ID);

  if (!getJson(url, response)) {
    return;
  }

  applyIntField(response, "sleep_threshold", sleepThreshold, 30, 3600);
  applyIntField(response, "distance_min_cm", bedMinDistanceCm, 20, 400);
  applyIntField(response, "distance_max_cm", bedMaxDistanceCm, 30, 600);
  applyIntField(response, "distance_quiet_cm", quietDistanceChangeCm, 1, 120);
  applyIntField(response, "distance_strong_cm", strongDistanceChangeCm, 5, 200);
  applyIntField(response, "out_of_bed_limit", maxOutOfBedReadings, 1, 60);
  applyIntField(response, "ir_repeats", irRepeats, 0, 5);

  int autoPower = extractIntField(response, "auto_power_enabled");
  if (autoPower >= 0) {
    autoPowerEnabled = autoPower == 1;
  }

  if (bedMinDistanceCm >= bedMaxDistanceCm) {
    bedMaxDistanceCm = bedMinDistanceCm + 10;
  }

  if (quietDistanceChangeCm >= strongDistanceChangeCm) {
    strongDistanceChangeCm = quietDistanceChangeCm + 5;
  }
}

void sendTvPower(int sendCount = 1) {
  sendCount = clampInt(sendCount, 1, 5);

  for (int i = 0; i < sendCount; i++) {
    irsend.sendSAMSUNG(0xE0E019E6, 32, irRepeats);

    if (i < sendCount - 1) {
      delay(250);
    }
  }
}

void completeServerCommand(int commandId, const char* status, int filteredDistance, const char* note) {
  String json = "{";
  json += "\"id\":" + String(commandId);
  json += ",\"status\":\"" + String(status) + "\"";
  json += ",\"sleep_score\":" + String(sleepScore);
  json += ",\"dist_filtered\":" + String(filteredDistance);
  json += ",\"note\":\"" + String(note) + "\"";
  json += "}";

  postJson(serverUrl("/api/commands/complete"), json);
}

bool checkServerCommands(int filteredDistance) {
  if (millis() - lastCommandCheck < COMMAND_CHECK_INTERVAL_MS) {
    return false;
  }

  lastCommandCheck = millis();

  String response;
  String url = serverUrl("/api/commands/next") + "?device_id=" + String(DEVICE_ID);

  if (!getJson(url, response)) {
    return false;
  }

  int commandId = extractIntField(response, "id");

  if (commandId <= 0 || response.indexOf("tv_power") < 0) {
    return false;
  }

  int repeatCount = extractIntField(response, "repeat_count");
  if (repeatCount <= 0) {
    repeatCount = 1;
  }

  sendTvPower(repeatCount);
  tvAlreadyOff = true;
  completeServerCommand(commandId, "done", filteredDistance, "TV OFF sent by ESP32");

  return true;
}

void sendReadingToServer(
  bool radarConnected,
  bool presence,
  bool personInBed,
  bool moving,
  bool still,
  bool stableDistance,
  int movingEnergy,
  int stillEnergy,
  int selectedDistance,
  int filteredDistance,
  int distanceChange,
  bool tvCommandSent,
  const String& scoreReason) {
  if (millis() - lastServerUpload < SERVER_UPLOAD_INTERVAL_MS && !tvCommandSent) {
    return;
  }

  lastServerUpload = millis();

  String json = "{";
  json += "\"device_id\":\"" + String(DEVICE_ID) + "\"";
  json += ",\"mode\":\"" + String(autoPowerEnabled ? "AUTO" : "MONITOR") + "\"";
  json += ",\"threshold\":" + String(sleepThreshold);
  json += ",\"radar_ok\":" + boolJson(radarConnected);
  json += ",\"presence\":" + boolJson(presence);
  json += ",\"in_bed\":" + boolJson(personInBed);
  json += ",\"moving\":" + boolJson(moving);
  json += ",\"still\":" + boolJson(still);
  json += ",\"stable\":" + boolJson(stableDistance);
  json += ",\"energy_moving\":" + String(movingEnergy);
  json += ",\"energy_still\":" + String(stillEnergy);
  json += ",\"dist_raw\":" + String(selectedDistance);
  json += ",\"dist_filtered\":" + String(filteredDistance);
  json += ",\"dist_change\":" + String(distanceChange);
  json += ",\"sleep_score\":" + String(sleepScore);
  json += ",\"out_of_bed_count\":" + String(consecutiveOutOfBedReadings);
  json += ",\"tv_command_sent\":" + boolJson(tvCommandSent);
  json += ",\"score_reason\":\"" + escapeJson(scoreReason) + "\"";
  json += "}";

  bool sent = postJson(serverUrl("/api/readings"), json);

  Serial.print(" | Server reading: ");
  Serial.print(sent ? "OK" : "NO");
}

void sendEventToServer(const char* eventType, int filteredDistance, const char* note) {
  String json = "{";
  json += "\"device_id\":\"" + String(DEVICE_ID) + "\"";
  json += ",\"event_type\":\"" + String(eventType) + "\"";
  json += ",\"sleep_score\":" + String(sleepScore);
  json += ",\"dist_filtered\":" + String(filteredDistance);
  json += ",\"note\":\"" + String(note) + "\"";
  json += "}";

  bool sent = postJson(serverUrl("/api/events"), json);

  Serial.print(" | Server event: ");
  Serial.print(sent ? "OK" : "NO");
}

void resetDistanceFilter() {
  distanceHistoryCount = 0;
  distanceHistoryIndex = 0;
}

void addDistanceToFilter(int distance) {
  distanceHistory[distanceHistoryIndex] = distance;
  distanceHistoryIndex = (distanceHistoryIndex + 1) % DISTANCE_SAMPLE_COUNT;

  if (distanceHistoryCount < DISTANCE_SAMPLE_COUNT) {
    distanceHistoryCount++;
  }
}

int calculateFilteredDistance() {
  if (distanceHistoryCount == 0) {
    return -1;
  }

  int values[DISTANCE_SAMPLE_COUNT];

  for (int i = 0; i < distanceHistoryCount; i++) {
    values[i] = distanceHistory[i];
  }

  for (int i = 0; i < distanceHistoryCount - 1; i++) {
    for (int j = i + 1; j < distanceHistoryCount; j++) {
      if (values[j] < values[i]) {
        int temporary = values[i];
        values[i] = values[j];
        values[j] = temporary;
      }
    }
  }

  int center = distanceHistoryCount / 2;

  if (distanceHistoryCount % 2 == 1) {
    return values[center];
  }

  return (values[center - 1] + values[center]) / 2;
}

void configureRadarIfNeeded() {
  if (!CONFIGURE_RADAR_ON_BOOT) {
    return;
  }

  Serial.println("Checking LD2410C configuration");

  if (!radar.requestCurrentConfiguration()) {
    Serial.println("LD2410C configuration was not read: keeping current values");
    return;
  }

  Serial.print("Current radar config | Max moving gate: ");
  Serial.print(radar.max_moving_gate);
  Serial.print(" | Max stationary gate: ");
  Serial.print(radar.max_stationary_gate);
  Serial.print(" | Timeout: ");
  Serial.print(radar.sensor_idle_time);
  Serial.println(" s");

  bool configurationAlreadyCorrect =
    radar.max_moving_gate == RADAR_MAX_MOVING_GATE && radar.max_stationary_gate == RADAR_MAX_STATIONARY_GATE && radar.sensor_idle_time == RADAR_INACTIVITY_TIMER_S;

  if (configurationAlreadyCorrect) {
    Serial.println("LD2410C configuration is already correct");
    return;
  }

  Serial.println("Setting LD2410C to short range: about 1.5 m");

  if (!radar.setMaxValues(RADAR_MAX_MOVING_GATE, RADAR_MAX_STATIONARY_GATE, RADAR_INACTIVITY_TIMER_S)) {
    Serial.println("Error: LD2410C configuration was not saved");
    return;
  }

  Serial.println("LD2410C configuration saved, restarting sensor");

  if (radar.requestRestart()) {
    delay(1000);
    radar.begin(Serial2);
    Serial.println("LD2410C restarted");
  } else {
    Serial.println("Warning: LD2410C restart failed");
  }
}

bool validDistance(int d) {
  return d >= bedMinDistanceCm && d <= bedMaxDistanceCm;
}

int chooseBestDistance(int stillDistance, int movingDistance) {
  if (validDistance(stillDistance)) {
    return stillDistance;
  }

  if (validDistance(movingDistance)) {
    return movingDistance;
  }

  return -1;
}

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("Starting TV Sleep Monitor - filtered distance build");

  Serial2.begin(256000, SERIAL_8N1, RADAR_RX_PIN, RADAR_TX_PIN);

  if (radar.begin(Serial2)) {
    Serial.println("LD2410C connected");
    configureRadarIfNeeded();
  } else {
    Serial.println("Error: LD2410C not found");
  }

  irsend.begin();
  connectWifi();
  loadServerSettings(true);

  Serial.print("Automatic TV OFF: ");
  Serial.println(autoPowerEnabled ? "ON" : "MONITOR ONLY");
  Serial.print("Sleep threshold: ");
  Serial.print(sleepThreshold);
  Serial.println(" approximate seconds");

  Serial.println("System ready");
}

void loop() {
  radar.read();
  ensureWifi();
  handleOTA();

  if (millis() - lastLoopCheck < 1000) {
    return;
  }

  lastLoopCheck = millis();
  loadServerSettings();

  bool radarConnected = radar.isConnected();
  bool presence = radarConnected && radar.presenceDetected();
  bool moving = radarConnected && radar.movingTargetDetected();
  bool still = radarConnected && radar.stationaryTargetDetected();

  int movingEnergy = radarConnected ? radar.movingTargetEnergy() : 0;
  int stillEnergy = radarConnected ? radar.stationaryTargetEnergy() : 0;

  int movingDistance = radarConnected ? radar.movingTargetDistance() : 0;
  int stillDistance = radarConnected ? radar.stationaryTargetDistance() : 0;

  int selectedDistance = chooseBestDistance(stillDistance, movingDistance);

  bool personInBed = presence && selectedDistance != -1;
  int filteredDistance = -1;

  if (personInBed) {
    addDistanceToFilter(selectedDistance);
    filteredDistance = calculateFilteredDistance();
  }

  int logicDistance = filteredDistance != -1 ? filteredDistance : selectedDistance;

  int distanceChange = 0;
  bool stableDistance = false;
  bool strongMovement = false;
  bool tvCommandSentThisLoop = false;
  bool dashboardCommandThisLoop = false;
  bool automaticCommandThisLoop = false;
  String scoreReason = "";

  if (personInBed && lastValidDistance != -1) {
    distanceChange = abs(logicDistance - lastValidDistance);

    stableDistance = distanceChange <= quietDistanceChangeCm;
    strongMovement = distanceChange >= strongDistanceChangeCm;
  }

  if (!personInBed) {
    consecutiveOutOfBedReadings++;

    if (consecutiveOutOfBedReadings >= maxOutOfBedReadings) {
      sleepScore = 0;
      lastValidDistance = -1;
      resetDistanceFilter();
      tvAlreadyOff = false;
      scoreReason = "reset: out of bed";
    } else {
      sleepScore -= 1;
      scoreReason = "-1 outside bed range";
    }
  } else {
    consecutiveOutOfBedReadings = 0;

    if (lastValidDistance == -1) {
      lastValidDistance = logicDistance;
    }

    if (strongMovement) {
      sleepScore -= 8;
      scoreReason = "-8 strong movement";
    } else if (stableDistance && still) {
      sleepScore += 1;
      scoreReason = "+1 stable and still";
    } else if (stableDistance) {
      sleepScore += 1;
      scoreReason = "+1 stable distance";
    } else {
      sleepScore -= 1;
      scoreReason = "-1 unstable distance";
    }

    lastValidDistance = logicDistance;
  }

  if (sleepScore < 0) {
    sleepScore = 0;
  }

  if (sleepScore > sleepThreshold) {
    sleepScore = sleepThreshold;
  }

  if (checkServerCommands(filteredDistance)) {
    tvCommandSentThisLoop = true;
    dashboardCommandThisLoop = true;
  }

  Serial.print("Radar: ");
  Serial.print(radarConnected ? "OK" : "NO");

  Serial.print(" | Presence: ");
  Serial.print(presence ? "YES" : "NO");

  Serial.print(" | In bed: ");
  Serial.print(personInBed ? "YES" : "NO");

  Serial.print(" | Out of bed: ");
  Serial.print(consecutiveOutOfBedReadings);
  Serial.print("/");
  Serial.print(maxOutOfBedReadings);

  Serial.print(" | Mov: ");
  Serial.print(moving ? "YES" : "NO");

  Serial.print(" | E mov: ");
  Serial.print(movingEnergy);

  Serial.print(" | Still: ");
  Serial.print(still ? "YES" : "NO");

  Serial.print(" | E still: ");
  Serial.print(stillEnergy);

  Serial.print(" | Dist raw: ");
  Serial.print(selectedDistance);

  Serial.print(" | Dist filtered: ");
  Serial.print(filteredDistance);

  Serial.print(" | Dist change: ");
  Serial.print(distanceChange);

  Serial.print(" | Stable: ");
  Serial.print(stableDistance ? "YES" : "NO");

  Serial.print(" | Sleep score: ");
  Serial.print(sleepScore);

  Serial.print(" | Reason: ");
  Serial.print(scoreReason);

  if (dashboardCommandThisLoop) {
    Serial.print(" | DASHBOARD TV OFF");
  }

  if (sleepScore >= sleepThreshold && !tvAlreadyOff && autoPowerEnabled) {
    Serial.print(" | TV OFF");
    sendTvPower(1);
    tvAlreadyOff = true;
    tvCommandSentThisLoop = true;
    automaticCommandThisLoop = true;
  } else if (sleepScore >= sleepThreshold && !autoPowerEnabled) {
    Serial.print(" | THRESHOLD REACHED - MONITOR ONLY");
  }

  sendReadingToServer(
    radarConnected,
    presence,
    personInBed,
    moving,
    still,
    stableDistance,
    movingEnergy,
    stillEnergy,
    selectedDistance,
    filteredDistance,
    distanceChange,
    tvCommandSentThisLoop,
    scoreReason);

  if (automaticCommandThisLoop) {
    sendEventToServer("tv_power_off_attempt", filteredDistance, "Sleep threshold reached");
  }

  Serial.println();
}
