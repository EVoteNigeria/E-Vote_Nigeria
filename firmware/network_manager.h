#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"

class AppNetworkManager {
public:
  static void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    Serial.print("Connecting to Wi-Fi: ");
    Serial.println(WIFI_SSID);

    WiFi.disconnect(true);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 25) {
      delay(500);
      Serial.print(".");
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\n[Wi-Fi] Connected successfully!");
      Serial.print("[Wi-Fi] IP Address: ");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("\n[Wi-Fi] Connection failed or timed out.");
    }
  }

  static bool isOnline() {
    return (WiFi.status() == WL_CONNECTED);
  }
};
