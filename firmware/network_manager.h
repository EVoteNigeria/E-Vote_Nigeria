#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"

class AppNetworkManager {
public:
  static void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      vTaskDelay(pdMS_TO_TICKS(500));
      attempts++;
    }
  }

  static bool isOnline() {
    return (WiFi.status() == WL_CONNECTED);
  }
};
