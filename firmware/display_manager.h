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

  // Hardware-accurate cursor placement for 16x4 HD44780 LCD
  // NOTE: Standard LiquidCrystal_I2C library hardcodes row offsets for 20x4 LCDs:
  //   row 0: 0x00, row 1: 0x40, row 2: 0x14, row 3: 0x54
  // For 16x4 LCDs, row 2 begins at 0x10 and row 3 begins at 0x50.
  // Using 0x14 and 0x54 shifts rows 2 and 3 four columns to the right,
  // which caused text on lines 3 and 4 to be cut off!
  void setCursor(uint8_t col, uint8_t row) {
    const uint8_t row_offsets[] = { 0x00, 0x40, 0x10, 0x50 };
    if (row >= 4) row = 3;
    lcd.command(0x80 | (col + row_offsets[row]));
  }

  void begin() {
    Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
    lcd.init();
    lcd.backlight();
    lcd.clear();
  }

  void clear() {
    lcd.clear();
  }

  void showConnectingWiFi(const String &ssid, int attempt, int maxAttempts) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" E-VOTE NIGERIA "));
    setCursor(0, 1);
    lcd.print(pad16(" Connecting WiFi"));
    setCursor(0, 2);
    String s = ssid.length() > 14 ? ssid.substring(0, 14) : ssid;
    lcd.print(pad16(" " + s));
    setCursor(0, 3);
    int dots = (attempt % 6) + 1;
    String bar = " [";
    for (int i = 0; i < dots; i++) bar += ".";
    while (bar.length() < 10) bar += " ";
    bar += "] ";
    bar += String(attempt) + "/" + String(maxAttempts);
    lcd.print(pad16(bar));
  }

  void showWiFiConnected(const String &ip, int rssi) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" WiFi CONNECTED!"));
    setCursor(0, 1);
    String ipStr = " IP:" + ip;
    lcd.print(pad16(ipStr));
    setCursor(0, 2);
    String sigStr = " Signal: " + String(rssi) + "dBm";
    lcd.print(pad16(sigStr));
    setCursor(0, 3);
    lcd.print(pad16(" Terminal Ready "));
  }

  void showWiFiFailed(const String &ssid) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" ! WiFi FAILED !"));
    setCursor(0, 1);
    String s = ssid.length() > 14 ? ssid.substring(0, 14) : ssid;
    lcd.print(pad16(" " + s));
    setCursor(0, 2);
    lcd.print(pad16(" Check secrets.h"));
    setCursor(0, 3);
    lcd.print(pad16(" Starting Offline"));
  }

  void showNetworkDiagnostics(bool isOnline, const String &ip, int rssi, const String &ssid) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" NET DIAGNOSTICS"));
    setCursor(0, 1);
    if (isOnline) {
      lcd.print(pad16(" Stat: ONLINE   "));
      setCursor(0, 2);
      lcd.print(pad16(" IP:" + ip));
    } else {
      lcd.print(pad16(" Stat: OFFLINE  "));
      setCursor(0, 2);
      String s = ssid.length() > 9 ? ssid.substring(0, 9) : ssid;
      lcd.print(pad16(" SSID:" + s));
    }
    setCursor(0, 3);
    lcd.print(pad16(" *Back   #Reconn"));
  }

  void showWelcome(bool isOnline = true) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" E-VOTE NIGERIA "));
    setCursor(0, 1);
    if (isOnline) {
      lcd.print(pad16(" [ONLINE] PU-01 "));
    } else {
      lcd.print(pad16(" [OFFLINE] NO-NET"));
    }
    setCursor(0, 2);
    lcd.print(pad16(" Enter Voter ID:"));
    setCursor(0, 3);
    lcd.print(pad16(" ID: [        ] "));
  }

  void updateOnlineStatusLine(bool isOnline) {
    setCursor(0, 1);
    if (isOnline) {
      lcd.print(pad16(" [ONLINE] PU-01 "));
    } else {
      lcd.print(pad16(" [OFFLINE] NO-NET"));
    }
  }

  void updateVoterIdInput(const String &idBuffer) {
    setCursor(6, 3);
    String displayStr = idBuffer;
    while (displayStr.length() < 8) displayStr += " ";
    lcd.print(displayStr.substring(0, 8));
  }

  void showVoterIdentified(const String &name) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" Voter Verified "));
    setCursor(0, 1);
    String n = name.startsWith(" ") ? name : (" " + name);
    lcd.print(pad16(n));
    setCursor(0, 2);
    lcd.print(pad16(" Place Finger On"));
    setCursor(0, 3);
    lcd.print(pad16(" Sensor To Scan "));
  }

  void showPartyPage(int pageNum, int totalPages, 
                     const String &pA, const String &pB, 
                     const String &pC, const String &pD) {
    lcd.clear();
    // Row 1: Selection instruction
    setCursor(0, 0);
    lcd.print(pad16(" Select Party:  "));

    // Row 2: Navigation & page count
    setCursor(0, 1);
    String nav = " *Prev " + String(pageNum) + "/" + String(totalPages) + " #Next";
    lcd.print(pad16(nav));

    // Row 3: First pair of choices (choice A has 1 leading space)
    setCursor(0, 2);
    String row3 = pad8(pA.length() > 0 ? (" " + String("A:") + pA) : " ") + 
                  pad8(pB.length() > 0 ? ("B:" + pB) : "");
    lcd.print(pad16(row3));

    // Row 4: Second pair of choices (choice C has 1 leading space)
    setCursor(0, 3);
    String row4 = pad8(pC.length() > 0 ? (" " + String("C:") + pC) : " ") + 
                  pad8(pD.length() > 0 ? ("D:" + pD) : "");
    lcd.print(pad16(row4));
  }

  void showConfirmation(const String &partyAcronym, char letter) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" Vote: " + partyAcronym));
    setCursor(0, 1);
    lcd.print(pad16(" " + String(letter) + " to CONFIRM"));
    setCursor(0, 2);
    lcd.print(pad16(" * to CANCEL"));
    setCursor(0, 3);
    lcd.print(pad16(""));
  }

  void showVotingProgress() {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" Submitting Vote"));
    setCursor(0, 1);
    lcd.print(pad16(" Contact server "));
    setCursor(0, 2);
    lcd.print(pad16(" Please wait... "));
    setCursor(0, 3);
    lcd.print(pad16(""));
  }

  void showVoteSuccess() {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16("================"));
    setCursor(0, 1);
    lcd.print(pad16(" VOTE RECORDED! "));
    setCursor(0, 2);
    lcd.print(pad16(" Thank you!     "));
    setCursor(0, 3);
    lcd.print(pad16("================"));
  }

  void showError(const String &line1, const String &line2) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" ! ERROR/ALERT! "));
    setCursor(0, 1);
    String l1 = line1.startsWith(" ") ? line1 : (" " + line1);
    lcd.print(pad16(l1));
    setCursor(0, 2);
    String l2 = line2.startsWith(" ") ? line2 : (" " + line2);
    lcd.print(pad16(l2));
    setCursor(0, 3);
    lcd.print(pad16(""));
  }

  void showEnrollPrompt(int slot, const String &name) {
    lcd.clear();
    setCursor(0, 0);
    lcd.print(pad16(" ENROLL FINGER  "));
    setCursor(0, 1);
    lcd.print(pad16(" Slot #" + String(slot)));
    setCursor(0, 2);
    String n = name.startsWith(" ") ? name : (" " + name);
    lcd.print(pad16(n));
    setCursor(0, 3);
    lcd.print(pad16(" Place finger   "));
  }
};
