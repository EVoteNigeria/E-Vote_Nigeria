#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "config.h"

class DisplayManager {
private:
  LiquidCrystal_I2C lcd;

  // Helper to format string into exact 16-character row
  String pad16(const String &str) {
    String res = str;
    while (res.length() < 16) res += " ";
    return res.substring(0, 16);
  }

  // Helper to format half-column into 8 characters
  String pad8(const String &str) {
    String res = str;
    while (res.length() < 8) res += " ";
    return res.substring(0, 8);
  }

public:
  DisplayManager() : lcd(LCD_I2C_ADDR, LCD_COLS, LCD_ROWS) {}

  void begin() {
    Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
    lcd.init();
    lcd.backlight();
    lcd.clear();
  }

  void clear() {
    lcd.clear();
  }

  void showWelcome() {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(pad16("  E-VOTE NIGERIA"));
    lcd.setCursor(0, 1);
    lcd.print(pad16(" BIOMETRIC UNIT "));
    lcd.setCursor(0, 2);
    lcd.print(pad16("Enter Voter ID: "));
    lcd.setCursor(0, 3);
    lcd.print(pad16("ID: [        ]  "));
  }

  void updateVoterIdInput(const String &idBuffer) {
    lcd.setCursor(5, 3);
    String displayStr = idBuffer;
    while (displayStr.length() < 8) displayStr += " ";
    lcd.print(displayStr.substring(0, 8));
  }

  void showVoterIdentified(const String &name) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(pad16("Voter Verified: "));
    lcd.setCursor(0, 1);
    lcd.print(pad16(name));
    lcd.setCursor(0, 2);
    lcd.print(pad16("Place Finger on "));
    lcd.setCursor(0, 3);
    lcd.print(pad16("Sensor to Verify"));
  }

  void showPartyPage(int pageNum, int totalPages, 
                     const String &pA, const String &pB, 
                     const String &pC, const String &pD) {
    lcd.clear();
    // Row 1: Selection instruction
    lcd.setCursor(0, 0);
    lcd.print(pad16("Choose a party:"));

    // Row 2: Navigation & page count
    lcd.setCursor(0, 1);
    String nav = "*Prev " + String(pageNum) + "/" + String(totalPages) + " #Next";
    lcd.print(pad16(nav));

    // Row 3: First pair of choices
    lcd.setCursor(0, 2);
    String row3 = pad8(pA.length() > 0 ? ("A:" + pA) : "") + 
                  pad8(pB.length() > 0 ? ("B:" + pB) : "");
    lcd.print(row3);

    // Row 4: Second pair of choices
    lcd.setCursor(0, 3);
    String row4 = pad8(pC.length() > 0 ? ("C:" + pC) : "") + 
                  pad8(pD.length() > 0 ? ("D:" + pD) : "");
    lcd.print(row4);
  }

  void showConfirmation(const String &partyAcronym, char letter) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(pad16("SELECTED: " + partyAcronym));
    lcd.setCursor(0, 1);
    lcd.print(pad16("Press " + String(letter) + " to CONFIRM"));
    lcd.setCursor(0, 2);
    lcd.print(pad16("Press * to CANCEL"));
    lcd.setCursor(0, 3);
    lcd.print(pad16("                  "));
  }

  void showVotingProgress() {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(pad16("Recording Ballot"));
    lcd.setCursor(0, 1);
    lcd.print(pad16("Contacting server"));
    lcd.setCursor(0, 2);
    lcd.print(pad16("Please wait...  "));
    lcd.setCursor(0, 3);
    lcd.print(pad16("                "));
  }

  void showVoteSuccess() {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(pad16("================"));
    lcd.setCursor(0, 1);
    lcd.print(pad16(" VOTE RECORDED! "));
    lcd.setCursor(0, 2);
    lcd.print(pad16(" Thank you!     "));
    lcd.setCursor(0, 3);
    lcd.print(pad16("================"));
  }

  void showError(const String &line1, const String &line2) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(pad16("! ERROR / ALERT !"));
    lcd.setCursor(0, 1);
    lcd.print(pad16(line1));
    lcd.setCursor(0, 2);
    lcd.print(pad16(line2));
    lcd.setCursor(0, 3);
    lcd.print(pad16("                "));
  }

  void showEnrollPrompt(int slot, const String &name) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(pad16("ENROLL FINGER:  "));
    lcd.setCursor(0, 1);
    lcd.print(pad16("Slot #" + String(slot)));
    lcd.setCursor(0, 2);
    lcd.print(pad16(name));
    lcd.setCursor(0, 3);
    lcd.print(pad16("Place finger now"));
  }
};
