#pragma once

// ========================================================
// BIOMETRIC ELECTRONIC VOTING SYSTEM - CONFIGURATION
// ========================================================

// 1. Terminal Identity & Security
#define DEVICE_ID             "ESP32-01"
#define DEVICE_API_KEY        "terminal-secret-key-01"
#define FIRMWARE_VERSION      "1.0.0"

// 2. Hardware Pin Assignments (Exact wiring from schematic)
// I2C 16x4 LCD Display
#define PIN_LCD_SDA           21
#define PIN_LCD_SCL           22
#define LCD_I2C_ADDR          0x27
#define LCD_COLS              16
#define LCD_ROWS              4

// AS608 Optical Fingerprint Sensor (UART2)
#define PIN_AS608_RX          16   // ESP32 RX2 connects to AS608 TX
#define PIN_AS608_TX          17   // ESP32 TX2 connects to AS608 RX
#define AS608_BAUD            57600

// 4x4 Keypad Pin Mapping
// Rows
#define PIN_KEYPAD_R1         13
#define PIN_KEYPAD_R2         18   // Changed from strapping pin GPIO 12 to safe GPIO 18
#define PIN_KEYPAD_R3         14
#define PIN_KEYPAD_R4         27
// Columns
#define PIN_KEYPAD_C1         26
#define PIN_KEYPAD_C2         25
#define PIN_KEYPAD_C3         33
#define PIN_KEYPAD_C4         32

// Audio Feedback (Active Buzzer)
#define PIN_BUZZER            4

// 3. Operational Timing & Constraints
#define HEARTBEAT_INTERVAL_MS 10000 // Send telemetry every 10s
#define SENSOR_SCAN_TIMEOUT_S 15    // Max seconds waiting for finger scan
#define MAX_FP_ATTEMPTS       3     // Max verification attempts
#define VOTER_ID_MAX_LEN      8
#define VOTER_ID_MIN_LEN      4
