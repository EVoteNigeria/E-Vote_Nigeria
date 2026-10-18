#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "secrets.h"
#include "config.h"

struct VoterLookupResult {
  String status; // AUTHORIZED_FOR_BIOMETRIC, INVALID, INELIGIBLE, ALREADY_VOTED, NO_FINGERPRINT
  String voterName;
  int expectedSlot;
  String errorMessage;
};

struct BallotOption {
  String id;
  String partyAcronym;
  String lcdLabel;
  int displayOrder;
};

class ApiClient {
private:
  void beginRequest(HTTPClient &http, WiFiClientSecure &client, const String &url) {
    if (url.startsWith("https://")) {
      client.setInsecure();
      client.setTimeout(15);
      http.setReuse(false);
      http.setTimeout(15000);
      http.begin(client, url);
    } else {
      http.setReuse(false);
      http.setTimeout(10000);
      http.begin(url);
    }
  }

public:
  ApiClient() {}

  void begin() {}

  bool isConnected() {
    return (WiFi.status() == WL_CONNECTED);
  }

  // Heartbeat & Command Polling
  bool sendHeartbeat(int slotsUsed, String &outCmdType, String &outCmdPayload) {
    if (!isConnected()) return false;

    WiFiClientSecure client;
    HTTPClient http;
    beginRequest(http, client, String(SERVER_HOST) + ENDPOINT_HEARTBEAT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", DEVICE_API_KEY);

    StaticJsonDocument<256> doc;
    doc["device_id"] = DEVICE_ID;
    doc["firmware_version"] = FIRMWARE_VERSION;
    doc["wifi_connected"] = true;
    doc["sensor_connected"] = true;
    doc["sensor_slots_used"] = slotsUsed;
    doc["sensor_slot_capacity"] = 127;

    String requestBody;
    serializeJson(doc, requestBody);

    int httpCode = http.POST(requestBody);
    Serial.printf("[Heartbeat] POST -> %d\n", httpCode);
    if (httpCode == 200) {
      String response = http.getString();
      StaticJsonDocument<512> respDoc;
      deserializeJson(respDoc, response);

      if (respDoc["has_command"].as<bool>()) {
        outCmdType = respDoc["command"]["command_type"].as<String>();
        outCmdPayload = respDoc["command"]["parameters"].as<String>();
      }
      http.end();
      return true;
    } else if (httpCode < 0) {
      Serial.printf("[Heartbeat Error] %s\n", http.errorToString(httpCode).c_str());
    }

    http.end();
    return false;
  }

  // Lookup Voter ID
  VoterLookupResult lookupVoter(const String &voterId) {
    VoterLookupResult result;
    if (!isConnected()) {
      result.status = "ERROR";
      result.errorMessage = "No Wi-Fi Link";
      return result;
    }

    WiFiClientSecure client;
    HTTPClient http;
    String url = String(SERVER_HOST) + ENDPOINT_VOTER_LOOKUP + "?voter_id=" + voterId;
    beginRequest(http, client, url);
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", DEVICE_API_KEY);

    int code = http.GET();
    if (code == 200) {
      String payload = http.getString();
      StaticJsonDocument<512> doc;
      deserializeJson(doc, payload);

      result.status = doc["status"].as<String>();
      if (result.status == "AUTHORIZED_FOR_BIOMETRIC") {
        result.voterName = doc["voter_name"].as<String>();
        result.expectedSlot = doc["expected_sensor_slot_id"].as<int>();
      } else {
        result.errorMessage = doc["message"].as<String>();
      }
    } else {
      result.status = "ERROR";
      result.errorMessage = "Server " + String(code);
    }
    http.end();
    return result;
  }

  // Fetch active political party options
  int fetchBallotOptions(BallotOption* optionsArray, int maxOptions, String &electionIdOut) {
    if (!isConnected()) return 0;

    WiFiClientSecure client;
    HTTPClient http;
    beginRequest(http, client, String(SERVER_HOST) + ENDPOINT_BALLOT_OPTS);
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", DEVICE_API_KEY);

    int code = http.GET();
    int count = 0;

    if (code == 200) {
      String payload = http.getString();
      DynamicJsonDocument doc(4096);
      deserializeJson(doc, payload);

      electionIdOut = doc["election_id"].as<String>();
      JsonArray arr = doc["options"].as<JsonArray>();

      for (JsonObject obj : arr) {
        if (count >= maxOptions) break;
        optionsArray[count].id = obj["id"].as<String>();
        optionsArray[count].partyAcronym = obj["party_acronym"].as<String>();
        optionsArray[count].lcdLabel = obj["lcd_label"].as<String>();
        optionsArray[count].displayOrder = obj["display_order"].as<int>();
        count++;
      }
    }
    http.end();
    return count;
  }

  // Submit Cast Ballot atomically to server
  bool submitBallot(const String &electionId, const String &voterId, const String &optionId, int slotId) {
    if (!isConnected()) return false;

    WiFiClientSecure client;
    HTTPClient http;
    beginRequest(http, client, String(SERVER_HOST) + ENDPOINT_CAST_BALLOT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", DEVICE_API_KEY);

    StaticJsonDocument<256> doc;
    doc["election_id"] = electionId;
    doc["voter_id"] = voterId;
    doc["selected_option_id"] = optionId;
    doc["fingerprint_slot_id"] = slotId;

    String body;
    serializeJson(doc, body);

    int code = http.POST(body);
    http.end();
    return (code == 200);
  }

  // Report enrollment completion to server
  void reportEnrollmentResult(const String &cmdId, const String &voterId, int slotId, bool success, const String &errMsg) {
    if (!isConnected()) return;

    WiFiClientSecure client;
    HTTPClient http;
    beginRequest(http, client, String(SERVER_HOST) + ENDPOINT_ENROLL_RESULT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", DEVICE_API_KEY);

    StaticJsonDocument<256> doc;
    doc["command_id"] = cmdId;
    doc["voter_id"] = voterId;
    doc["sensor_slot_id"] = slotId;
    doc["success"] = success;
    doc["error_message"] = errMsg;

    String body;
    serializeJson(doc, body);
    http.POST(body);
    http.end();
  }
};
