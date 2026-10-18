/*
 ============================================================================
  BIOMETRIC ELECTRONIC VOTING SYSTEM - ESP32 FIRMWARE
  Hardware:
    - ESP32 Microcontroller
    - AS608 Optical Fingerprint Sensor (UART2: GPIO 16 RX2, GPIO 17 TX2)
    - 16x4 I2C LCD Display (GPIO 21 SDA, GPIO 22 SCL)
    - 4x4 Matrix Keypad (Rows: 13, 12, 14, 27 | Cols: 26, 25, 33, 32)
    - Active Piezo Buzzer (GPIO 4)
  RTOS Architecture:
    - Task 1 (Core 1): UI, LCD, Keypad, AS608 Sensor, Voting State Machine
    - Task 2 (Core 0): Background Wi-Fi, Telemetry Heartbeat, Command Polling
 ============================================================================
*/

#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>

#include "config.h"
#include "secrets.h"
#include "display_manager.h"
#include "keypad_manager.h"
#include "fingerprint_manager.h"
#include "buzzer_manager.h"
#include "api_client.h"
#include "network_manager.h"

// System Components
DisplayManager     display;
KeypadManager      keypad;
FingerprintManager fpSensor;
BuzzerManager      buzzer;
ApiClient          api;

// State Machine Definitions
enum TerminalState {
  STATE_WELCOME_ENTER_ID,
  STATE_VERIFYING_VOTER_ID,
  STATE_PROMPT_FINGERPRINT,
  STATE_DISPLAY_BALLOT,
  STATE_CONFIRM_VOTE,
  STATE_SUBMITTING_BALLOT,
  STATE_VOTE_SUCCESS,
  STATE_ALERT_MESSAGE,
  STATE_HARDWARE_ENROLLMENT
};

TerminalState currentState = STATE_WELCOME_ENTER_ID;

// Runtime Context
String currentVoterId = "";
String currentVoterName = "";
int expectedFingerprintSlot = -1;
String activeElectionId = "";

// Party Ballot Pagination
BallotOption ballotOptions[16];
int totalOptionsCount = 0;
int currentBallotPage = 0;
int selectedOptionIndex = -1;
char pendingConfirmKey = '\0';

// FreeRTOS Task Handles & Synchronization
TaskHandle_t networkTaskHandle = NULL;
SemaphoreHandle_t networkMutex = NULL;

// Background Network & Heartbeat Task (Runs on Core 0)
void NetworkWorkerTask(void *pvParameters) {
  Serial.println("[NetworkWorker] Background task started on Core 0");
  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS);

  for (;;) {
    if (!AppNetworkManager::isOnline()) {
      Serial.println("[NetworkWorker] Wi-Fi offline, attempting reconnect...");
      AppNetworkManager::connectWiFi();
    }

    if (AppNetworkManager::isOnline()) {
      if (xSemaphoreTake(networkMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
        String cmdType = "";
        String cmdPayload = "";
        int slots = fpSensor.getTemplateCount();

        Serial.printf("[NetworkWorker] Sending heartbeat (slots: %d)...\n", slots);
        bool ok = api.sendHeartbeat(slots, cmdType, cmdPayload);
        if (ok && cmdType == "ENROLL_FINGERPRINT") {
          // Parse remote enrollment command
          StaticJsonDocument<512> doc;
          deserializeJson(doc, cmdPayload);
          int targetSlot = doc["sensor_slot_id"].as<int>();
          String voterName = doc["voter_name"].as<String>();
          String voterId = doc["voter_id"].as<String>();

          // Switch UI state to enrollment
          currentState = STATE_HARDWARE_ENROLLMENT;
          display.showEnrollPrompt(targetSlot, voterName);

          // Perform enrollment
          bool enrolled = fpSensor.enrollSlot(targetSlot);
          if (enrolled) {
            buzzer.successTone();
            display.showError("Enroll Success!", "Slot #" + String(targetSlot));
            api.reportEnrollmentResult("", voterId, targetSlot, true, "");
          } else {
            buzzer.errorTone();
            display.showError("Enroll Failed", "Try again");
            api.reportEnrollmentResult("", voterId, targetSlot, false, "Fingerprint scan failed");
          }
          vTaskDelay(pdMS_TO_TICKS(2500));
          currentState = STATE_WELCOME_ENTER_ID;
          currentVoterId = "";
          display.showWelcome();
        }
        xSemaphoreGive(networkMutex);
      }
    }

    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

// Reset Terminal back to Idle Welcome Screen
void resetToWelcome() {
  currentVoterId = "";
  currentVoterName = "";
  expectedFingerprintSlot = -1;
  selectedOptionIndex = -1;
  pendingConfirmKey = '\0';
  currentBallotPage = 0;
  currentState = STATE_WELCOME_ENTER_ID;
  display.showWelcome();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  // Initialize Peripherals
  buzzer.begin();
  buzzer.keyClick();

  display.begin();
  display.showWelcome();

  keypad.begin();

  // Initialize AS608 Optical Sensor
  if (!fpSensor.begin()) {
    display.showError("AS608 Sensor", "NOT DETECTED");
    buzzer.errorTone();
    delay(2000);
    display.showWelcome();
  }

  // Create Network Mutex
  networkMutex = xSemaphoreCreateMutex();

  // Initial Wi-Fi link
  AppNetworkManager::connectWiFi();

  // Launch Background Network Task on Core 0
  BaseType_t taskRes = xTaskCreatePinnedToCore(
    NetworkWorkerTask,
    "NetworkWorker",
    16384, // 16KB stack required for mbedTLS TLS handshake
    NULL,
    1,
    &networkTaskHandle,
    0
  );
  if (taskRes == pdPASS) {
    Serial.println("[Setup] NetworkWorker task created on Core 0 successfully.");
  } else {
    Serial.println("[Setup Error] Failed to create NetworkWorker task!");
  }
}

void loop() {
  char key = keypad.getKey();

  if (key) {
    buzzer.keyClick();
  }

  switch (currentState) {
    // ----------------------------------------------------
    // STATE 1: Enter Numeric Voter ID
    // ----------------------------------------------------
    case STATE_WELCOME_ENTER_ID: {
      if (key >= '0' && key <= '9') {
        if (currentVoterId.length() < VOTER_ID_MAX_LEN) {
          currentVoterId += key;
          display.updateVoterIdInput(currentVoterId);
        }
      } else if (key == '*') {
        // Clear input buffer
        currentVoterId = "";
        display.updateVoterIdInput(currentVoterId);
      } else if (key == '#') {
        // Submit Voter ID
        if (currentVoterId.length() >= VOTER_ID_MIN_LEN) {
          currentState = STATE_VERIFYING_VOTER_ID;
          display.clear();
          display.showError("Verifying Voter", "Please wait...");

          if (xSemaphoreTake(networkMutex, pdMS_TO_TICKS(2000)) == pdTRUE) {
            VoterLookupResult lookup = api.lookupVoter(currentVoterId);
            xSemaphoreGive(networkMutex);

            if (lookup.status == "AUTHORIZED_FOR_BIOMETRIC") {
              currentVoterName = lookup.voterName;
              expectedFingerprintSlot = lookup.expectedSlot;
              display.showVoterIdentified(currentVoterName);
              currentState = STATE_PROMPT_FINGERPRINT;
            } else {
              buzzer.errorTone();
              display.showError(lookup.status, lookup.errorMessage);
              delay(3000);
              resetToWelcome();
            }
          }
        } else {
          buzzer.errorTone();
        }
      }
      break;
    }

    // ----------------------------------------------------
    // STATE 2: Verify AS608 Fingerprint
    // ----------------------------------------------------
    case STATE_PROMPT_FINGERPRINT: {
      int matchedSlot = fpSensor.scanAndMatch(SENSOR_SCAN_TIMEOUT_S);

      if (matchedSlot == expectedFingerprintSlot) {
        buzzer.keyClick();
        display.clear();
        display.showError("MATCH CONFIRMED!", "Loading Ballot");

        // Fetch Ballot Options for election
        if (xSemaphoreTake(networkMutex, pdMS_TO_TICKS(2000)) == pdTRUE) {
          totalOptionsCount = api.fetchBallotOptions(ballotOptions, 16, activeElectionId);
          xSemaphoreGive(networkMutex);
        }

        if (totalOptionsCount > 0) {
          currentBallotPage = 0;
          currentState = STATE_DISPLAY_BALLOT;
          renderBallotScreen();
        } else {
          buzzer.errorTone();
          display.showError("No Active Party", "Contact Admin");
          delay(3000);
          resetToWelcome();
        }
      } else if (matchedSlot > 0 && matchedSlot != expectedFingerprintSlot) {
        buzzer.errorTone();
        display.showError("MISMATCH!", "Wrong Finger");
        delay(3000);
        resetToWelcome();
      } else {
        // Timeout or unrecognized scan
        buzzer.errorTone();
        display.showError("Scan Timed Out", "No Match Found");
        delay(3000);
        resetToWelcome();
      }
      break;
    }

    // ----------------------------------------------------
    // STATE 3: Paginated Party Ballot Selection
    // ----------------------------------------------------
    case STATE_DISPLAY_BALLOT: {
      int totalPages = max(1, (totalOptionsCount + 3) / 4);

      if (key == '*') {
        // Previous page
        if (currentBallotPage > 0) {
          currentBallotPage--;
          renderBallotScreen();
        }
      } else if (key == '#') {
        // Next page
        if (currentBallotPage < totalPages - 1) {
          currentBallotPage++;
          renderBallotScreen();
        }
      } else if (key >= 'A' && key <= 'D') {
        int idx = (currentBallotPage * 4) + (key - 'A');
        if (idx < totalOptionsCount) {
          selectedOptionIndex = idx;
          pendingConfirmKey = key;
          currentState = STATE_CONFIRM_VOTE;
          display.showConfirmation(ballotOptions[idx].partyAcronym, key);
        }
      }
      break;
    }

    // ----------------------------------------------------
    // STATE 4: Repeat Letter Confirmation
    // ----------------------------------------------------
    case STATE_CONFIRM_VOTE: {
      if (key == pendingConfirmKey) {
        // Confirmed! Submit ballot atomically to backend
        currentState = STATE_SUBMITTING_BALLOT;
        display.showVotingProgress();

        bool success = false;
        if (xSemaphoreTake(networkMutex, pdMS_TO_TICKS(3000)) == pdTRUE) {
          success = api.submitBallot(
            activeElectionId,
            currentVoterId,
            ballotOptions[selectedOptionIndex].id,
            expectedFingerprintSlot
          );
          xSemaphoreGive(networkMutex);
        }

        if (success) {
          buzzer.successTone();
          display.showVoteSuccess();
          delay(4000);
          resetToWelcome();
        } else {
          buzzer.errorTone();
          display.showError("Vote Submission", "Failed/Rejected");
          delay(3000);
          resetToWelcome();
        }
      } else if (key == '*') {
        // Cancel and return to ballot screen
        currentState = STATE_DISPLAY_BALLOT;
        renderBallotScreen();
      }
      break;
    }

    default:
      break;
  }

  delay(20);
}

// Helper to render paginated 16x4 LCD choices
void renderBallotScreen() {
  int totalPages = max(1, (totalOptionsCount + 3) / 4);
  int base = currentBallotPage * 4;

  String pA = (base < totalOptionsCount) ? ballotOptions[base].lcdLabel : "";
  String pB = (base + 1 < totalOptionsCount) ? ballotOptions[base + 1].lcdLabel : "";
  String pC = (base + 2 < totalOptionsCount) ? ballotOptions[base + 2].lcdLabel : "";
  String pD = (base + 3 < totalOptionsCount) ? ballotOptions[base + 3].lcdLabel : "";

  display.showPartyPage(currentBallotPage + 1, totalPages, pA, pB, pC, pD);
}
