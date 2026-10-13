# CHAPTER THREE: METHODOLOGY

## 3.1 Introduction
This chapter details the engineering methodology, system design principles, hardware interfacing, firmware state machines, backend architecture, and operational workflows implemented in the design and construction of the Secure Biometric Electronic Voting System (E-Vote). The system is engineered to solve the persistent challenges of voter impersonation, multiple voting, ballot box tampering, collation delays, and ballot secrecy compromise that plague conventional electoral processes.

The implementation follows a modular, bottom-up systems engineering methodology divided into five distinct stages:
1. **Requirements Specification and Component Selection:** Identifying operational constraints, current draw limits, peripheral GPIO requirements, and communication protocols.
2. **Hardware Interfacing and Power Supply Design:** Circuit design, schematic drafting, voltage regulation (5 V and 3.3 V rails), and pin interconnection between the ESP32, AS608 optical fingerprint sensor, 16×4 I2C LCD, 4×4 matrix keypad, and piezo buzzer.
3. **Embedded Firmware Architecture:** Development of dual-core FreeRTOS C++ firmware incorporating an 9-state terminal state machine, non-blocking hardware drivers, paginated ballot menus, and network watchdogs.
4. **Backend Server and Zero-Linkage Database Engineering:** Implementing an asynchronous REST API using Python FastAPI, accompanied by a relational SQLite database in Write-Ahead Logging (WAL) mode that physically and relationally decouples voter identity from cast ballots.
5. **Administrative Web Interface and System Integration:** Crafting a responsive administrative dashboard for remote voter enrollment queuing, candidate management, terminal telemetry monitoring, and certified real-time tallying.

---

## 3.2 Materials

### 3.2.1 Hardware Components
The physical voting terminal relies on carefully selected, commercially available embedded hardware modules chosen for low power consumption, mechanical resilience, and computational performance. The primary hardware devices include:

1. **ESP32-WROOM-32 Microcontroller Development Board:**  
   The core computational engine of the terminal. Features a dual-core 32-bit Xtensa LX6 microprocessor operating at up to 240 MHz, 520 KB SRAM, 4 MB external flash memory, integrated 2.4 GHz 802.11 b/g/n Wi-Fi, hardware UART/I2C controllers, and hardware cryptographic acceleration (AES, SHA-2, RSA).
2. **AS608 Optical Fingerprint Identification Module:**  
   High-performance optical biometric scanner equipped with a toughened glass prism, internal green/blue LED illuminator, CMOS image sensor, onboard 32-bit DSP processor, and 512-byte flash memory storing up to 300 fingerprint templates ($1:N$ search speed $<1.0\text{ s}$, False Acceptance Rate $<0.001\%$).
3. **16×4 Liquid Crystal Display (LCD 1604A/2004A with PCF8574 I2C Module):**  
   High-contrast alphanumeric display providing 4 lines of 16 characters each, interfaced through a PCF8574 I2C backpack operating at default I2C address `0x27`. Reduces the GPIO requirement from 10 pins down to 2 (`SDA` and `SCL`).
4. **4×4 Matrix Keypad:**  
   A 16-key tactile membrane matrix keypad featuring 4 row lines and 4 column lines. Configured with alphanumeric legends (`0`–`9`, `A`, `B`, `C`, `D`, `*`, `#`) for voter ID entry, candidate navigation, confirmation, and cancellation.
5. **Active Piezoelectric Buzzer (5 V):**  
   Audible transducer providing multi-frequency acoustic feedback patterns (short chirp for key press, dual beep for successful authentication, long continuous alarm for unauthorized/duplicate attempts).
6. **Power Supply & Voltage Regulation Stage:**  
   External DC source (9 V–12 V battery pack or AC/DC adapter) stepped down via an LM2596 high-efficiency DC–DC buck converter and AMS1117-3.3 linear regulator to provide decoupled 5 V and 3.3 V rails.
7. **Prototyping Materials:**  
   FR-4 copper-clad Vero boards, decoupling filter capacitors ($100\,\mu\text{F}$ electrolytic and $0.1\,\mu\text{F}$ ceramic), tactile switches, terminal blocks, ribbon cables, and an impact-resistant ABS plastic project enclosure.

### 3.2.2 Software Tools and Development Environments
1. **Arduino IDE (Version 2.3+ with ESP32 Board Core):**  
   Used for authoring, compiling, profiling, and flashing the dual-core C++ firmware to the ESP32. Utilizes the following core open-source libraries:
   - `Adafruit Fingerprint Sensor Library` (UART driver for AS608 command packets).
   - `LiquidCrystal_I2C` (PCF8574 I2C protocol driver).
   - `Keypad` (Non-blocking matrix scanning and software debouncing).
   - `ArduinoJson` (v6/v7 high-efficiency zero-copy JSON parsing).
   - `WiFi.h` & `HTTPClient.h` (TCP/IP stack and RESTful client).
2. **Python 3.11+ & FastAPI Ecosystem:**  
   High-performance asynchronous backend server framework executing on the Uvicorn ASGI server. Uses Pydantic for data validation, Starlette for HTTP routing, and Passlib / Bcrypt for administrative password hashing.
3. **SQLite3 Database Engine (WAL Mode):**  
   Zero-configuration relational database server embedded directly within Python, configured with `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL` to enforce ACID guarantees and high concurrent throughput.
4. **Proteus Design Suite (Version 8.13):**  
   Employed for schematic capture, circuit verification, PCB layout routing, and electrical rules checking (ERC).
5. **Frontend Web Technologies (HTML5 / Vanilla CSS3 / JavaScript ES6):**  
   Used to build the responsive administrative dashboard without heavy third-party framework overhead, communicating with FastAPI via authenticated REST endpoints.

---

## 3.3 System Design Architecture
The overall architecture of the Biometric Electronic Voting System is illustrated in the functional block diagram below:

```
+---------------------------------------------------------------------------------------------------------+
|                                    SYSTEM ARCHITECTURAL BLOCK DIAGRAM                                   |
|                                                                                                         |
|   +------------------------------------+               +--------------------------------------------+   |
|   |         POLLING TERMINAL           |               |           CENTRAL BACKEND SERVER           |   |
|   |                                    |               |                                            |   |
|   |   +----------------------------+   |               |   +------------------------------------+   |   |
|   |   | AS608 Fingerprint Sensor   |   |               |   | Python FastAPI REST Server (ASGI)  |   |   |
|   |   | (UART2: GPIO 16 RX, 17 TX) |   |               |   | - Token Authentication             |   |   |
|   |   +-------------+--------------+   |               |   | - Biometric Enrollment Dispatcher  |   |   |
|   |                 |                  |   HTTP/REST   |   | - Atomic ACID Ballot Ingestion     |   |   |
|   |   +-------------v--------------+   |  Wi-Fi Link   |   +-----------------+------------------+   |   |
|   |   |   ESP32 Microcontroller    | <===============> |                     |                      |   |
|   |   | - Core 1: Voting UI / State|   |   (IEEE       |   +-----------------v------------------+   |   |
|   |   | - Core 0: Background Wi-Fi |   |   802.11b/g)  |   |    SQLite WAL Database Engine      |   |   |
|   |   +------+-------------+-------+   |               |   |  - voter_participation (No Party)  |   |   |
|   |          |             |           |               |   |  - ballots (Anonymous, No Voter)  |   |   |
|   |   +------v------+   +--v-------+   |               |   +-----------------+------------------+   |   |
|   |   | 16x4 LCD    |   | 4x4      |   |               |                     |                      |   |
|   |   | (I2C: 21/22)|   | Keypad   |   |               |   +-----------------v------------------+   |   |
|   |   +-------------+   +----------+   |               |   | Web Administration Dashboard       |   |   |
|   |   | Active Buzzer (GPIO 4)     |   |               |   | (Live Tallies, Voter Management)   |   |   |
|   |   +----------------------------+   |               |   +------------------------------------+   |   |
|   +------------------------------------+               +--------------------------------------------+   |
+---------------------------------------------------------------------------------------------------------+
```

### 3.3.1 Hardware Interfacing and Pin Mapping
The ESP32 pin allocation was designed to avoid strapping pins (GPIO 0, 2, 12, 15) that interfere with boot modes, flashing sequences, or internal voltage selection. Table 2 provides the complete pin interconnection mapping.

#### Table 2: Complete Hardware Pin Interconnections of the ESP32 Polling Terminal
| S/N | Subsystem / Module | Module Pin | ESP32 GPIO Pin | Function / Electrical Notes |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **AS608 Fingerprint** | VCC | 5V / 3.3V | Module operating power rail |
| 2 | | GND | GND | Common circuit ground |
| 3 | | TX | GPIO 16 (RX2) | Hardware UART2 Receive (from AS608 TX) |
| 4 | | RX | GPIO 17 (TX2) | Hardware UART2 Transmit (to AS608 RX) |
| 5 | **16×4 LCD (PCF8574)**| VCC | 5V | Display driver and LED backlight power |
| 6 | | GND | GND | Common circuit ground |
| 7 | | SDA | GPIO 21 | I2C Serial Data (pull-up onboard module) |
| 8 | | SCL | GPIO 22 | I2C Serial Clock (pull-up onboard module) |
| 9 | **4×4 Matrix Keypad** | Row 1 | GPIO 13 | Digital Output (active LOW drive) |
| 10| | Row 2 | GPIO 18 | Digital Output (safe GPIO, avoiding GPIO 12) |
| 11| | Row 3 | GPIO 14 | Digital Output (active LOW drive) |
| 12| | Row 4 | GPIO 27 | Digital Output (active LOW drive) |
| 13| | Column 1 | GPIO 26 | Digital Input (internal pull-up enabled) |
| 14| | Column 2 | GPIO 25 | Digital Input (internal pull-up enabled) |
| 15| | Column 3 | GPIO 33 | Digital Input (internal pull-up enabled) |
| 16| | Column 4 | GPIO 32 | Digital Input (internal pull-up enabled) |
| 17| **Active Buzzer** | Positive (+) | GPIO 4 | Digital Output (HIGH activates buzzer) |
| 18| | Negative (-) | GND | Common circuit ground |

### 3.3.2 Power Supply Unit Design
The polling terminal requires clean, regulated DC voltage rails with sufficient instantaneous current capacity to handle Wi-Fi radio transmission peaks (up to $240\,\text{mA}$) and AS608 optical illumination bursts (up to $120\,\text{mA}$).

$$\text{Total Peak Current Budget } I_{\text{total}} = I_{\text{ESP32}} + I_{\text{AS608}} + I_{\text{LCD}} + I_{\text{Buzzer}} + I_{\text{Keypad}}$$
$$I_{\text{total}} = 240\,\text{mA} + 120\,\text{mA} + 50\,\text{mA} + 30\,\text{mA} + 10\,\text{mA} = 450\,\text{mA}$$

#### Table 3: Power Distribution and Current Consumption Budget
| S/N | Component | Operating Voltage | Typical Current | Peak Current | Power Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | ESP32-WROOM-32 | 3.3 V DC | 80 mA | 240 mA (RF burst) | AMS1117-3.3 Rail |
| 2 | AS608 Biometric Sensor | 3.3 V – 5.0 V DC | 40 mA | 120 mA (Optical LED) | Regulated 5V Rail |
| 3 | 16×4 LCD + PCF8574 | 5.0 V DC | 25 mA | 50 mA (Backlight) | Regulated 5V Rail |
| 4 | Active Buzzer | 5.0 V DC | 15 mA | 30 mA | Regulated 5V Rail via NPN |
| 5 | Keypad Logic | 3.3 V DC | 2 mA | 10 mA | ESP32 GPIO Rail |
| **—**| **Complete Terminal** | **5.0 V / 3.3 V** | **162 mA** | **450 mA** | **LM2596 (Step-Down)** |

An external DC input ($9\,\text{V}$–$12\,\text{V}$) is routed through a reverse-polarity protection Schottky diode (1N5819) into an LM2596 step-down switching regulator configured for a stable $5.0\,\text{V}$ output ($3.0\,\text{A}$ rating, $150\,\text{kHz}$ switching frequency). Filter capacitors ($470\,\mu\text{F}$ and $0.1\,\mu\text{F}$) decouple the $5\,\text{V}$ line, which feeds the LCD backlight, buzzer, and the ESP32 onboard AMS1117 linear regulator that generates the noise-free $3.3\,\text{V}$ logic supply.

### 3.3.3 Firmware Architecture (FreeRTOS Dual-Core State Machine)
The terminal firmware is engineered in C++ using a finite state machine (FSM) architecture running on Core 1, synchronized via FreeRTOS semaphores with a background networking worker task executing on Core 0.

#### Table 4: Polling Terminal Finite State Machine (FSM) Definition
| State | State Identifier | Description and Core 1 Activity | Exit Transition Trigger |
| :---: | :--- | :--- | :--- |
| **0** | `STATE_WELCOME_ENTER_ID` | Displays *"ENTER VOTER ID"*, listens for 4–8 digits from keypad. | Voter presses `#` (Submit) or `*` (Clear) |
| **1** | `STATE_VERIFYING_VOTER_ID`| Displays *"VERIFYING ID..."*, executes REST API query to backend. | API response: Eligible / Ineligible / Voted |
| **2** | `STATE_PROMPT_FINGERPRINT`| Displays voter name and *"PLACE FINGER"*, scans AS608 optical sensor. | Finger matched against assigned slot or timeout |
| **3** | `STATE_DISPLAY_BALLOT` | Displays candidate pages on 16×4 LCD (`A`=Prev, `B`=Next, `1`–`9`=Pick). | Valid candidate index selected |
| **4** | `STATE_CONFIRM_VOTE` | Displays *"VOTE FOR [PARTY]? Press # to CONFIRM, * to CANCEL"*. | `#` pressed (Confirmed) or `*` pressed (Cancel) |
| **5** | `STATE_SUBMITTING_BALLOT`| Displays *"SUBMITTING BALLOT"*, dispatches decoupled REST vote payload. | Backend returns HTTP 200 OK |
| **6** | `STATE_VOTE_SUCCESS` | Displays *"BALLOT RECORDED! THANK YOU"*, sounds confirmation chime. | 3-second display timeout |
| **7** | `STATE_ALERT_MESSAGE` | Displays rejection reason (*"ALREADY VOTED"*, *"UNAUTHORIZED"*, etc.). | 3-second buzzer error timeout |
| **8** | `STATE_HARDWARE_ENROLLMENT`| Intercepts remote admin command from Core 0; captures fingerprint twice. | Template generated and saved in slot ID |

### 3.3.4 Zero-Linkage Database Schema Architecture
The core security guarantee of this system is enforced at the database layer. In strict compliance with constitutional ballot privacy norms, two decoupled tables represent voter participation and cast ballots.

#### Table 5: Database Schema Comparison of the Zero-Linkage Model
| Table Name | Primary Key | Key Foreign Fields | Critical Architectural Isolation Guarantee |
| :--- | :--- | :--- | :--- |
| `voters` | `id` (UUID) | `voter_id` (Numeric) | Stores demographic identity and registration credentials. |
| `voter_fingerprint_mappings`| `id` (UUID) | `voter_id`, `sensor_slot_id` | Associates voter with biometric hardware slot on terminal. |
| `voter_participation` | `id` (UUID) | `election_id`, `voter_id` | **Contains NO party or candidate ID.** Only flags that the voter voted. |
| `ballots` | `ballot_id` (UUID) | `election_id`, `selected_option_id` | **Contains NO voter_id, NO slot_id, NO identity.** Completely anonymous. |

#### Atomic Transaction Execution (FastAPI / SQLite)
When a vote is submitted to `/api/terminal/ballot/cast`, the database executes within an atomic transaction:
```python
cursor.execute("BEGIN IMMEDIATE TRANSACTION;")

# 1. Verify and record participation (Prevents double-voting)
cursor.execute("""
    INSERT INTO voter_participation (id, election_id, voter_id, participation_status, voted)
    VALUES (?, ?, ?, 'Voted', 1);
""", (str(uuid.uuid4()), election_id, voter_db_id))

# 2. Record anonymous ballot (Zero Linkage to voter)
cursor.execute("""
    INSERT INTO ballots (ballot_id, election_id, selected_option_id, ballot_status)
    VALUES (?, ?, ?, 'Accepted');
""", (str(uuid.uuid4()), election_id, selected_option_id))

conn.commit()
```
If an individual attempts to vote twice, the `UNIQUE(election_id, voter_id)` constraint on `voter_participation` immediately throws an `IntegrityError`, causing an immediate database rollback with zero ballots registered.

### 3.3.5 Terminal-to-Backend RESTful API Protocol
The terminal exchanges JSON payloads over HTTP with the FastAPI server. All requests include the terminal identity header (`X-Device-ID`) and security token (`X-Device-API-Key`). Table 6 outlines the endpoints utilized.

#### Table 6: Polling Terminal RESTful API Specification
| Endpoint | Method | Payload / Parameters | Server Response | Purpose |
| :--- | :---: | :--- | :--- | :--- |
| `/api/terminal/heartbeat` | `POST` | `sensor_slots_used` | `{"command": "...", "payload": "..."}` | Background health ping and remote enrollment queue dispatcher. |
| `/api/terminal/voter/verify` | `POST` | `voter_id` | `{"eligible": true, "fingerprint_slot": 12, "voter_name": "..."}` | Verifies voter registration status and returns assigned biometric slot. |
| `/api/terminal/ballot/options` | `GET` | `election_id` | `[{"option_id": "...", "party_acronym": "...", "lcd_label": "..."}]` | Retrieves active candidates formatted for 16×4 LCD display pagination. |
| `/api/terminal/ballot/cast` | `POST` | `election_id`, `voter_id`, `selected_option_id` | `{"success": true, "message": "Ballot accepted"}` | Executes atomic zero-linkage vote insertion. |
| `/api/terminal/enrollment/callback`| `POST`| `sensor_slot_id`, `status` | `{"acknowledged": true}` | Notifies web dashboard that remote biometric enrollment completed. |

---

## 3.4 Operational Flowcharts

### 3.4.1 Voter Authentication and Voting Sequence Flowchart
Figure 1 outlines the operational sequence executed by the voter at the physical polling terminal:

```
                                  [START]
                                     |
                                     v
                      +------------------------------+
                      | Display: "ENTER VOTER ID"    |
                      +------------------------------+
                                     |
                                     v
                      +------------------------------+
                      | Voter Enters Numeric ID via  |
                      | 4x4 Keypad and Presses '#'   |
                      +------------------------------+
                                     |
                                     v
                      +------------------------------+
                      | Send REST Request to Backend:|
                      | POST /api/terminal/voter/    |
                      | verify                       |
                      +------------------------------+
                                     |
                                     v
                       /----------------------------\
                      <   Voter Registered & Valid?  >
                       \----------------------------/
                               /            \
                       [NO]   /              \   [YES]
                             v                v
            +----------------------+   +------------------------------+
            | LCD: "VOTER UNKNOWN" |   | LCD: "NAME: [Voter Name]"    |
            | Buzzer: Error Alarm  |   | Display: "PLACE FINGER"      |
            +----------------------+   +------------------------------+
                             |                        |
                             v                        v
                          [REJECT]      /----------------------------\
                                       <  Already Voted in Election?  >
                                        \----------------------------/
                                                /            \
                                        [YES]  /              \  [NO]
                                              v                v
                             +----------------------+   +------------------------------+
                             | LCD: "ALREADY VOTED" |   | Scan Finger via AS608 Optical|
                             | Buzzer: Error Alarm  |   | Sensor (Timeout = 15s)       |
                             +----------------------+   +------------------------------+
                                              |                        |
                                              v                        v
                                           [REJECT]      /----------------------------\
                                                        <   Fingerprint Matched Assigned
                                                        <   Biometric Slot ID?         >
                                                         \----------------------------/
                                                                 /            \
                                                         [NO]   /              \   [YES]
                                                               v                v
                                              +----------------------+   +------------------------------+
                                              | LCD: "FINGER MISMATCH|   | Buzzer: Success Double Beep  |
                                              | LCD: "UNAUTHORIZED"  |   | Fetch Ballot Options via API |
                                              +----------------------+   +------------------------------+
                                                               |                        |
                                                               v                        v
                                                            [REJECT]     +------------------------------+
                                                                         | Display Paginated Candidates |
                                                                         | (A=Prev, B=Next, 1-9=Select) |
                                                                         +------------------------------+
                                                                                        |
                                                                                        v
                                                                         +------------------------------+
                                                                         | Voter Inputs Candidate Digit |
                                                                         | LCD: "VOTE [PARTY]? #-YES *-NO"|
                                                                         +------------------------------+
                                                                                        |
                                                                                        v
                                                                          /----------------------------\
                                                                         <    Voter Pressed '#' (Confirm)?>
                                                                          \----------------------------/
                                                                                  /            \
                                                                          [NO]   /              \   [YES]
                                                                                v                v
                                                                     (Return to Menu)    +------------------------------+
                                                                                         | POST /api/terminal/ballot/cast|
                                                                                         | (Atomic Zero-Linkage Commit) |
                                                                                         +------------------------------+
                                                                                                        |
                                                                                                        v
                                                                                         +------------------------------+
                                                                                         | LCD: "BALLOT RECORDED!"      |
                                                                                         | Buzzer: Long Confirmation     |
                                                                                         +------------------------------+
                                                                                                        |
                                                                                                        v
                                                                                                     [FINISH]
```

### 3.4.2 Remote Biometric Enrollment Sequence Flowchart
```
    [Admin Web Dashboard]                               [ESP32 Polling Terminal]
              |                                                     |
              | 1. Admin enters voter info & clicks                 |
              |    "Enroll Fingerprint"                             |
              v                                                     |
    +-------------------+                                           |
    | Enqueue Command   |                                           |
    | in Backend Server |                                           |
    +-------------------+                                           |
              |                                                     |
              | 2. Next Periodic Heartbeat (every 10s)              |
              |<----------------------------------------------------|
              | 3. Returns Command: "ENROLL_FINGERPRINT", Target Slot|
              |---------------------------------------------------->|
              |                                                     v
              |                                           +-------------------+
              |                                           | LCD: "ENROLLING"  |
              |                                           | "PLACE FINGER #1" |
              |                                           +-------------------+
              |                                                     |
              |                                           +-------------------+
              |                                           | AS608 Captures    |
              |                                           | Image -> CharBuf1 |
              |                                           +-------------------+
              |                                                     |
              |                                           +-------------------+
              |                                           | LCD: "REMOVE &    |
              |                                           | PLACE FINGER #2"  |
              |                                           +-------------------+
              |                                                     |
              |                                           +-------------------+
              |                                           | AS608 Captures    |
              |                                           | Image -> CharBuf2 |
              |                                           +-------------------+
              |                                                     |
              |                                           +-------------------+
              |                                           | Generate Template |
              |                                           | & Store in Slot   |
              |                                           +-------------------+
              |                                                     |
              | 4. POST /api/terminal/enrollment/callback           |
              |<----------------------------------------------------|
              v                                                     v
    +-------------------+                                 +-------------------+
    | Update Web UI:    |                                 | Buzzer Confirmation|
    | "Voter Enrolled"  |                                 | Return to Idle UI |
    +-------------------+                                 +-------------------+
```

---

## 3.5 Summary of Methodology
The integrated methodology combines deterministic hardware engineering with modern asynchronous software patterns. By combining the low-cost ESP32 microcontroller with an optical AS608 fingerprint scanner, tactile keypad, dynamic LCD pagination, and an ACID-compliant Python FastAPI backend utilizing the Zero-Linkage Ballot Secrecy Model, the system establishes a secure, transparent, verifiable, and privacy-preserving voting infrastructure.
