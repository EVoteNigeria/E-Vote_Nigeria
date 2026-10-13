#pragma once

#include <Arduino.h>
#include <Keypad.h>
#include "config.h"

const byte KEYPAD_ROWS = 4;
const byte KEYPAD_COLS = 4;

const char KEYMAP[KEYPAD_ROWS][KEYPAD_COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};

byte rowPins[KEYPAD_ROWS] = {PIN_KEYPAD_R1, PIN_KEYPAD_R2, PIN_KEYPAD_R3, PIN_KEYPAD_R4};
byte colPins[KEYPAD_COLS] = {PIN_KEYPAD_C1, PIN_KEYPAD_C2, PIN_KEYPAD_C3, PIN_KEYPAD_C4};

class KeypadManager {
private:
  Keypad keypad;

public:
  KeypadManager() : keypad(makeKeymap(KEYMAP), rowPins, colPins, KEYPAD_ROWS, KEYPAD_COLS) {}

  void begin() {
    // Keypad library configures internal pull-ups and pin states
  }

  char getKey() {
    return keypad.getKey();
  }
};
