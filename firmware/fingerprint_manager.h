#pragma once

#include <Arduino.h>
#include <Adafruit_Fingerprint.h>
#include "config.h"

class FingerprintManager {
private:
  HardwareSerial mySerial;
  Adafruit_Fingerprint finger;
  bool isInitialized;

public:
  FingerprintManager() : mySerial(2), finger(&mySerial), isInitialized(false) {}

  bool begin() {
    mySerial.begin(AS608_BAUD, SERIAL_8N1, PIN_AS608_RX, PIN_AS608_TX);
    finger.begin(AS608_BAUD);

    if (finger.verifyPassword()) {
      isInitialized = true;
      return true;
    }
    return false;
  }

  bool isReady() {
    return isInitialized;
  }

  int getTemplateCount() {
    if (!isInitialized) return 0;
    finger.getTemplateCount();
    return finger.templateCount;
  }

  // Returns matched slot ID (1-127) or -1 if no match / error
  int scanAndMatch(unsigned long timeoutSec = 15) {
    if (!isInitialized) return -1;

    unsigned long start = millis();
    int p = -1;

    // Wait until finger placed or timeout
    while ((millis() - start) < (timeoutSec * 1000)) {
      p = finger.getImage();
      if (p == FINGERPRINT_OK) break;
      vTaskDelay(pdMS_TO_TICKS(50));
    }

    if (p != FINGERPRINT_OK) return -1;

    // Convert image to template
    p = finger.image2Tz();
    if (p != FINGERPRINT_OK) return -1;

    // Search library
    p = finger.fingerFastSearch();
    if (p == FINGERPRINT_OK) {
      return finger.fingerID; // Returns matching slot ID
    }

    return -1;
  }

  // Enroll finger into a designated sensor slot ID (1 - 127)
  bool enrollSlot(int slotId, unsigned long timeoutSec = 20) {
    if (!isInitialized || slotId < 1 || slotId > 127) return false;

    int p = -1;
    unsigned long start = millis();

    // Step 1: First scan
    while ((millis() - start) < (timeoutSec * 1000)) {
      p = finger.getImage();
      if (p == FINGERPRINT_OK) break;
      vTaskDelay(pdMS_TO_TICKS(50));
    }
    if (p != FINGERPRINT_OK) return false;

    p = finger.image2Tz(1);
    if (p != FINGERPRINT_OK) return false;

    // Wait for finger release
    vTaskDelay(pdMS_TO_TICKS(1000));
    p = 0;
    while (p != FINGERPRINT_NOFINGER) {
      p = finger.getImage();
      vTaskDelay(pdMS_TO_TICKS(50));
    }

    // Step 2: Second scan
    start = millis();
    while ((millis() - start) < (timeoutSec * 1000)) {
      p = finger.getImage();
      if (p == FINGERPRINT_OK) break;
      vTaskDelay(pdMS_TO_TICKS(50));
    }
    if (p != FINGERPRINT_OK) return false;

    p = finger.image2Tz(2);
    if (p != FINGERPRINT_OK) return false;

    // Create model
    p = finger.createModel();
    if (p != FINGERPRINT_OK) return false;

    // Store in slot
    p = finger.storeModel(slotId);
    return (p == FINGERPRINT_OK);
  }
};
