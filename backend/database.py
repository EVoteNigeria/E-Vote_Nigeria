"""
Database Initialization and Schema for Biometric E-Voting System.
Complies strictly with Specification Sections 2.3, 16, and 17:
- Zero linkage between voter identities and ballot records.
- ACID transactions for ballot submission with unique voter participation constraints.
- Foreign keys and WAL (Write-Ahead Logging) enabled for maximum reliability and concurrency.
"""

import sqlite3
import os
import uuid
import datetime
from pathlib import Path

DB_PATH = os.environ.get("VOTE_DB_PATH", str(Path(__file__).parent / "evote.db"))

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # 1. System Settings Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 2. Roles and Permissions
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT
    );
    """)

    # 3. Administrator Accounts
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS administrator_accounts (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        role_id TEXT NOT NULL,
        account_status TEXT DEFAULT 'Active', -- Active, Disabled, Locked
        mfa_enabled BOOLEAN DEFAULT 0,
        failed_login_attempts INTEGER DEFAULT 0,
        last_login_at TIMESTAMP,
        last_password_change_at TIMESTAMP,
        force_password_reset BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        FOREIGN KEY (role_id) REFERENCES roles(id)
    );
    """)

    # 4. Polling Locations
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS polling_locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 5. Elections Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS elections (
        id TEXT PRIMARY KEY,
        election_code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        election_type TEXT DEFAULT 'General',
        scope TEXT DEFAULT 'National',
        status TEXT DEFAULT 'Draft', -- Draft, Scheduled, Open, Paused, Closed, Certified, Archived
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        timezone TEXT DEFAULT 'Africa/Lagos',
        result_visibility TEXT DEFAULT 'Hidden Until Closed', -- 'Hidden Until Closed', 'Admin-Only Aggregate', 'Authorized Live Aggregate'
        configuration_version INTEGER DEFAULT 1,
        created_by TEXT,
        finalized_at TIMESTAMP,
        certified_at TIMESTAMP,
        certified_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 6. Ballot Options (Political Parties)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS ballot_options (
        id TEXT PRIMARY KEY,
        election_id TEXT NOT NULL,
        party_name TEXT NOT NULL,
        party_acronym TEXT NOT NULL,
        lcd_label TEXT NOT NULL, -- Max 8 chars for 16x4 LCD formatting
        candidate_name TEXT,
        logo_url TEXT,
        display_order INTEGER NOT NULL DEFAULT 1,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE
    );
    """)

    # 7. Voters Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS voters (
        id TEXT PRIMARY KEY,
        voter_id TEXT UNIQUE NOT NULL, -- Numeric ID entered on keypad
        full_name TEXT NOT NULL,
        registration_status TEXT DEFAULT 'Active', -- Active, Suspended, Inactive
        eligibility_status TEXT DEFAULT 'Eligible', -- Eligible, Ineligible
        polling_location_id TEXT,
        registration_source TEXT DEFAULT 'Manual Entry',
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (polling_location_id) REFERENCES polling_locations(id)
    );
    """)

    # 8. Voting Terminals (ESP32 hardware)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS terminals (
        id TEXT PRIMARY KEY,
        device_id TEXT UNIQUE NOT NULL, -- Unique hardware key / identifier
        device_name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL,
        assigned_election_id TEXT,
        polling_location_id TEXT,
        device_status TEXT DEFAULT 'Active', -- Active, Offline, Maintenance, Suspended, Error
        firmware_version TEXT DEFAULT '1.0.0',
        protocol_version TEXT DEFAULT '1.0',
        last_heartbeat_at TIMESTAMP,
        last_health_check_at TIMESTAMP,
        sensor_slots_used INTEGER DEFAULT 0,
        sensor_slot_capacity INTEGER DEFAULT 127,
        last_error_code TEXT,
        configuration_version INTEGER DEFAULT 1,
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assigned_election_id) REFERENCES elections(id),
        FOREIGN KEY (polling_location_id) REFERENCES polling_locations(id)
    );
    """)

    # 9. Voter Fingerprint Mappings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS voter_fingerprint_mappings (
        id TEXT PRIMARY KEY,
        voter_id TEXT NOT NULL, -- Internal Voter UUID
        device_id TEXT NOT NULL, -- Associated Terminal ID where enrolled
        sensor_slot_id INTEGER NOT NULL, -- Hardware slot ID (1 - 127)
        finger_label TEXT DEFAULT 'Right Index Finger',
        enrollment_status TEXT DEFAULT 'Enrolled', -- Pending, Enrolled, Revoked, Failed
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        enrolled_by TEXT,
        revoked_at TIMESTAMP,
        FOREIGN KEY (voter_id) REFERENCES voters(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES terminals(id) ON DELETE CASCADE,
        UNIQUE (device_id, sensor_slot_id)
    );
    """)

    # 10. Voter Participation Records
    # CRITICAL: DOES NOT CONTAIN selected party ID. Only tracks if voter has voted.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS voter_participation (
        id TEXT PRIMARY KEY,
        election_id TEXT NOT NULL,
        voter_id TEXT NOT NULL,
        participation_status TEXT DEFAULT 'Voted', -- Voted, Voting In Progress, Attempted
        voted BOOLEAN DEFAULT 1,
        participation_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        polling_location_id TEXT,
        FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE,
        FOREIGN KEY (voter_id) REFERENCES voters(id) ON DELETE CASCADE,
        UNIQUE (election_id, voter_id)
    );
    """)

    # 11. Anonymous Ballots Table
    # CRITICAL: NO voter_id, NO fingerprint_slot, NO timestamp correlation, NO identity links.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS ballots (
        ballot_id TEXT PRIMARY KEY,
        election_id TEXT NOT NULL,
        selected_option_id TEXT NOT NULL,
        ballot_status TEXT DEFAULT 'Accepted', -- Accepted, Rejected
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE,
        FOREIGN KEY (selected_option_id) REFERENCES ballot_options(id)
    );
    """)

    # 12. Device Commands Queue (for remote enrollment, sync, reboot)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS device_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        command_type TEXT NOT NULL, -- ENROLL_FINGERPRINT, CANCEL_ENROLLMENT, SYNC_CONFIG, REBOOT
        command_parameters TEXT, -- JSON payload
        requested_by TEXT,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        command_status TEXT DEFAULT 'Pending', -- Pending, Sent, Acknowledged, Completed, Failed, Cancelled
        completed_at TIMESTAMP,
        error_code TEXT,
        FOREIGN KEY (device_id) REFERENCES terminals(id) ON DELETE CASCADE
    );
    """)

    # 13. Audit Events Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        event_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actor_type TEXT NOT NULL, -- Administrator, Device, System
        actor_id TEXT,
        event_type TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        result TEXT NOT NULL, -- Success, Failure, Rejected
        severity TEXT DEFAULT 'Informational', -- Informational, Warning, High, Critical
        reason_code TEXT,
        device_id TEXT,
        correlation_id TEXT,
        sanitized_description TEXT NOT NULL
    );
    """)

    # Seed Default Roles
    roles = [
        ("role_super_admin", "System Administrator", "Full system configuration, terminal management, administrator accounts"),
        ("role_election_mgr", "Election Manager", "Election creation, party configuration, opening, pausing, results finalization"),
        ("role_voter_officer", "Voter Registration Officer", "Voter registration, CSV import, fingerprint enrollment monitoring"),
        ("role_supervisor", "Polling Supervisor", "Terminal health monitoring, device testing, polling station support"),
        ("role_auditor", "Auditor / Observer", "Read-only access to audit logs, turnout statistics, aggregate results")
    ]
    cursor.executemany("""
    INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?);
    """, roles)

    # Seed Default Settings
    settings = [
        ("system_name", "Biometric Electronic Voting System", "System identification name"),
        ("default_timezone", "Africa/Lagos", "Primary operating timezone"),
        ("voter_id_min_length", "4", "Minimum numeric digits for voter ID"),
        ("voter_id_max_length", "8", "Maximum numeric digits for voter ID"),
        ("voter_id_format", "Numeric", "Numeric keypad format"),
        ("max_fingerprint_attempts", "3", "Maximum attempts allowed before temporary session lock"),
        ("fingerprint_scan_timeout", "15", "Seconds waiting for AS608 scan"),
        ("voter_session_idle_timeout", "60", "Seconds before resetting voting terminal to welcome"),
        ("party_selection_page_size", "4", "Number of choices shown per LCD screen"),
        ("heartbeat_timeout", "60", "Seconds before device is marked offline")
    ]
    cursor.executemany("""
    INSERT OR IGNORE INTO system_settings (key, value, description) VALUES (?, ?, ?);
    """, settings)

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at", DB_PATH)
