#pragma once

#include <Arduino.h>
#include "config.h"

class BuzzerManager {
public:
  void begin() {
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
  }

  // Short keypress tick
  void keyClick() {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(20);
    digitalWrite(PIN_BUZZER, LOW);
  }

  // Triumphant double-beep on successful ballot submission
  void successTone() {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(100);
    digitalWrite(PIN_BUZZER, LOW);
    delay(80);
    digitalWrite(PIN_BUZZER, HIGH);
    delay(250);
    digitalWrite(PIN_BUZZER, LOW);
  }

  // Alert buzz on rejected / error condition
  void errorTone() {
    for (int i = 0; i < 3; i++) {
      digitalWrite(PIN_BUZZER, HIGH);
      delay(120);
      digitalWrite(PIN_BUZZER, LOW);
      delay(80);
    }
  }
};
