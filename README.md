# Biometric Electronic Voting System

Complete end-to-end implementation of an Electronic Voting System featuring a **Web-Based Admin Dashboard**, a **Secure FastAPI REST Backend & SQLite Database**, and **ESP32 Microcontroller C++ Firmware** with AS608 Optical Fingerprint Sensor, 16x4 I2C LCD, 4x4 Matrix Keypad, and Buzzer.

---

## Architecture Overview

```
+------------------------------------+          +------------------------------------+
|           Admin Dashboard          |          |          ESP32 Terminal            |
|       (HTML5 / CSS / Vanilla JS)   |          |  (AS608, 16x4 LCD, 4x4 Keypad)    |
+-----------------+------------------+          +-----------------+------------------+
                  |                                               |
                  | [HTTPS / JWT Auth]                            | [Authenticated Device Protocol]
                  v                                               v
+------------------------------------------------------------------------------------+
|                                FastAPI Backend Server                              |
|   - Zero-Linkage Ballot Secrecy Architecture                                       |
|   - One-Vote-Per-Voter Enforcement via ACID Transactions                           |
|   - Dynamic 16x4 LCD Paginated Formatting                                          |
|   - Device Heartbeat & Remote Biometric Enrollment Queue                           |
+------------------------------------------------------------------------------------+
                                          |
                                          v
+------------------------------------------------------------------------------------+
|                                SQLite3 WAL Database                                |
|   - elections, voters, ballot_options, voter_fingerprint_mappings, terminals       |
|   - voter_participation (No party ID)  |  ballots (Anonymous, No voter ID)         |
+------------------------------------------------------------------------------------+
```

---

## 1. Running the Admin Dashboard & Backend

### Prerequisites
- Python 3.11+

### Start the Server
From the root directory (`E_Vote`):
```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### Access the Web Dashboard
Open your browser to:
[http://localhost:8000](http://localhost:8000)

**Default Admin Credentials:**
- **Username:** `admin`
- **Password:** `admin123`

---

## 2. ESP32 Firmware Setup

### Directory
All firmware files are located in [`firmware/`](firmware/):
- [`firmware.ino`](firmware/firmware.ino): FreeRTOS dual-core firmware application.
- [`config.h`](firmware/config.h): Hardware pin mapping and operational limits.
- [`secrets.h`](firmware/secrets.h): Wi-Fi credentials and server endpoints.
- [`display_manager.h`](firmware/display_manager.h): 16x4 LCD formatting and menu transitions.
- [`keypad_manager.h`](firmware/keypad_manager.h): Non-blocking 4x4 matrix keypad scanner.
- [`fingerprint_manager.h`](firmware/fingerprint_manager.h): AS608 optical biometric driver (UART2).
- [`buzzer_manager.h`](firmware/buzzer_manager.h): Audible feedback patterns.
- [`api_client.h`](firmware/api_client.h): HTTP client for voter verification and voting transactions.
- [`network_manager.h`](firmware/network_manager.h): Background Wi-Fi watchdog.

### Required Arduino Libraries
Install the following via Arduino IDE Library Manager:
1. `LiquidCrystal_I2C` (by Frank de Brabander)
2. `Keypad` (by Mark Stanley, Alexander Brevig)
3. `Adafruit Fingerprint Sensor Library` (by Adafruit)
4. `ArduinoJson` (by Benoît Blanchon)

### Hardware Pin Connections
| Component | ESP32 GPIO | Notes |
| :--- | :--- | :--- |
| **AS608 TX** | GPIO 16 (RX2) | Hardware UART2 |
| **AS608 RX** | GPIO 17 (TX2) | Hardware UART2 |
| **LCD SDA** | GPIO 21 | I2C Data (`0x27`) |
| **LCD SCL** | GPIO 22 | I2C Clock |
| **Buzzer (+)** | GPIO 4 | Active Buzzer |
| **Keypad Rows** | GPIO 13, 12, 14, 27 | R1, R2, R3, R4 |
| **Keypad Cols** | GPIO 26, 25, 33, 32 | C1, C2, C3, C4 |

---

## 3. Core System Guarantees & Acceptance Verification

1. **Ballot Privacy**:
   - The `ballots` table records only `(ballot_id, election_id, selected_option_id, ballot_status)`.
   - The `voter_participation` table records only `(voter_id, election_id, voted)`.
   - **Zero foreign key or relational linkage exists between who voted and which party was selected.**
2. **Duplicate Prevention**:
   - Unique constraints on `(election_id, voter_id)` prevent double voting.
3. **Automated Tests**:
   Run the test suite anytime:
   ```bash
   python -m unittest tests/test_voting.py
   ```
