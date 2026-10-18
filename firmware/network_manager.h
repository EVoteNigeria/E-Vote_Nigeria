#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"
#include "display_manager.h"
#include "buzzer_manager.h"

class AppNetworkManager {
public:
  static bool connectWiFi(DisplayManager* display = nullptr, BuzzerManager* buzzer = nullptr) {
    if (WiFi.status() == WL_CONNECTED) return true;

    Serial.print("Connecting to Wi-Fi: ");
    Serial.println(WIFI_SSID);

    WiFi.disconnect(true);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    const int maxAttempts = 20;

    while (WiFi.status() != WL_CONNECTED && attempts < maxAttempts) {
      delay(400);
      Serial.print(".");
      attempts++;
      if (display) {
        display->showConnectingWiFi(WIFI_SSID, attempts, maxAttempts);
      }
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\n[Wi-Fi] Connected successfully!");
      Serial.print("[Wi-Fi] IP Address: ");
      Serial.println(WiFi.localIP());

      if (display) {
        display->showWiFiConnected(WiFi.localIP().toString(), WiFi.RSSI());
      }
      if (buzzer) {
        buzzer->successTone();
      }
      delay(2000);
      return true;
    } else {
      Serial.println("\n[Wi-Fi] Connection failed or timed out.");
      if (display) {
        display->showWiFiFailed(WIFI_SSID);
      }
      if (buzzer) {
        buzzer->errorTone();
      }
      delay(2500);
      return false;
    }
  }

  static bool isOnline() {
    return (WiFi.status() == WL_CONNECTED);
  }

  static String getIP() {
    return isOnline() ? WiFi.localIP().toString() : "0.0.0.0";
  }

  static int getRSSI() {
    return isOnline() ? WiFi.RSSI() : 0;
  }

  static String getSSID() {
    return String(WIFI_SSID);
  }
};
