"""
Database Seeding Script.
Creates default administrators, sample election, sample political parties, and demo voters.
"""

import uuid
from database import get_db, init_db
from security import get_password_hash

def seed_data():
    init_db()
    conn = get_db()
    cursor = conn.cursor()

    # 1. Seed Default Admin Account: admin / admin123
    cursor.execute("SELECT id FROM administrator_accounts WHERE username = 'admin'")
    if not cursor.fetchone():
        admin_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO administrator_accounts (
                id, full_name, username, email, password_hash, role_id, account_status
            ) VALUES (?, 'Chief Electoral Commissioner', 'admin', 'admin@evote.local', ?, 'role_super_admin', 'Active')
        """, (admin_id, get_password_hash("admin123")))
        print("Default admin created: username: 'admin', password: 'admin123'")

    # 2. Seed Default Polling Location
    loc_id = "loc_lagos_central"
    cursor.execute("SELECT id FROM polling_locations WHERE id = ?", (loc_id,))
    if not cursor.fetchone():
        cursor.execute("""
            INSERT INTO polling_locations (id, name, code, address)
            VALUES (?, 'Lagos Central Polling Unit 01', 'PU-01-LAG', 'Civic Centre, Victoria Island, Lagos')
        """, (loc_id,))

    # 3. Seed Sample Election (Open for voting demo)
    el_id = "election_2026_presidential"
    cursor.execute("SELECT id FROM elections WHERE id = ?", (el_id,))
    if not cursor.fetchone():
        cursor.execute("""
            INSERT INTO elections (
                id, election_code, title, description, election_type, scope,
                status, starts_at, ends_at, timezone, result_visibility
            ) VALUES (
                ?, 'ELEC-2026-NIG', '2026 Presidential General Election',
                'National Biometric Electronic Presidential Election',
                'General', 'National', 'Open',
                '2026-10-12 08:00:00', '2026-10-12 20:00:00',
                'Africa/Lagos', 'Authorized Live Aggregate'
            )
        """, (el_id,))
        print("Sample election created: '2026 Presidential General Election' (Status: Open)")

    # 4. Seed Ballot Options (Political Parties) - Validated for 16x4 LCD formatting
    parties = [
        (str(uuid.uuid4()), el_id, "All Progressives Congress", "APC", "APC", "Bola Tinubu", 1),
        (str(uuid.uuid4()), el_id, "Peoples Democratic Party", "PDP", "PDP", "Atiku Abubakar", 2),
        (str(uuid.uuid4()), el_id, "Labour Party", "LP", "LP", "Peter Obi", 3),
        (str(uuid.uuid4()), el_id, "New Nigeria Peoples Party", "NNPP", "NNPP", "Rabiu Kwankwaso", 4),
        (str(uuid.uuid4()), el_id, "Social Democratic Party", "SDP", "SDP", "Adewole Adebayo", 5),
        (str(uuid.uuid4()), el_id, "African Democratic Congress", "ADC", "ADC", "Dumebi Kachikwu", 6),
    ]
    cursor.execute("SELECT COUNT(*) as count FROM ballot_options WHERE election_id = ?", (el_id,))
    if cursor.fetchone()["count"] == 0:
        cursor.executemany("""
            INSERT INTO ballot_options (
                id, election_id, party_name, party_acronym, lcd_label, candidate_name, display_order, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        """, parties)
        print("Sample political parties created.")

    # 5. Seed Terminal (ESP32-01)
    term_id = "term_esp32_01"
    cursor.execute("SELECT id FROM terminals WHERE device_id = 'ESP32-01'")
    if not cursor.fetchone():
        cursor.execute("""
            INSERT INTO terminals (
                id, device_id, device_name, api_key_hash, assigned_election_id, polling_location_id,
                device_status, firmware_version, last_heartbeat_at
            ) VALUES (?, 'ESP32-01', 'Voting Terminal 01 (Main Hall)', 'terminal-secret-key-01', ?, ?, 'Active', '1.0.0', CURRENT_TIMESTAMP)
        """, (term_id, el_id, loc_id))
        print("Default terminal registered: Device ID 'ESP32-01', Key: 'terminal-secret-key-01'")

    # 6. Seed Sample Voters
    demo_voters = [
        (str(uuid.uuid4()), "1001", "Adebayo Olawale", loc_id),
        (str(uuid.uuid4()), "1002", "Chidinma Okonkwo", loc_id),
        (str(uuid.uuid4()), "1003", "Musa Ibrahim", loc_id),
        (str(uuid.uuid4()), "1004", "Fatima Abubakar", loc_id),
        (str(uuid.uuid4()), "1005", "Emeka Nnamdi", loc_id),
        (str(uuid.uuid4()), "1006", "Zainab Bello", loc_id)
    ]
    for v_id, v_num, name, ploc in demo_voters:
        cursor.execute("SELECT id FROM voters WHERE voter_id = ?", (v_num,))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO voters (id, voter_id, full_name, registration_status, eligibility_status, polling_location_id)
                VALUES (?, ?, ?, 'Active', 'Eligible', ?)
            """, (v_id, v_num, name, ploc))

    # Pre-map Voter 1001 to sensor slot #1 on ESP32-01
    cursor.execute("SELECT id FROM voters WHERE voter_id = '1001'")
    v1 = cursor.fetchone()
    cursor.execute("SELECT id FROM terminals WHERE device_id = 'ESP32-01'")
    t1 = cursor.fetchone()
    if v1 and t1:
        cursor.execute("SELECT id FROM voter_fingerprint_mappings WHERE voter_id = ? AND device_id = ?", (v1["id"], t1["id"]))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO voter_fingerprint_mappings (
                    id, voter_id, device_id, sensor_slot_id, enrollment_status
                ) VALUES (?, ?, ?, 1, 'Enrolled')
            """, (str(uuid.uuid4()), v1["id"], t1["id"]))
            print("Pre-mapped Voter 1001 (Adebayo Olawale) to AS608 Slot #1 on ESP32-01.")

    conn.commit()
    conn.close()
    print("Seed process finished successfully!")

if __name__ == "__main__":
    seed_data()
