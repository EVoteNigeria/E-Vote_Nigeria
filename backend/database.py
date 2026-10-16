"""
Database Initialization and Schema for Biometric E-Voting System.
Supports both:
1. PostgreSQL (When DATABASE_URL is configured, e.g. Render Cloud Database / Supabase / Neon)
   - Persistent across server restarts, reboots, and spin-downs.
2. SQLite (Default local fallback for development)
   - Zero-configuration local database.

Complies strictly with Specification Sections 2.3, 16, and 17:
- Zero linkage between voter identities and ballot records.
- ACID transactions for ballot submission with unique voter participation constraints.
- Foreign keys and WAL (Write-Ahead Logging) enabled for maximum reliability and concurrency.
"""

import sqlite3
import os
import uuid
import datetime
import re
from pathlib import Path

NEON_DATABASE_URL = "postgresql://neondb_owner:npg_R6M2SGWNEejH@ep-snowy-salad-b4lw642q-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require"
DATABASE_URL = os.environ.get("DATABASE_URL", NEON_DATABASE_URL)
if os.environ.get("USE_LOCAL_SQLITE") == "1":
    DATABASE_URL = None
DB_PATH = os.environ.get("VOTE_DB_PATH", str(Path(__file__).parent / "evote.db"))

# Check for psycopg2 availability
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False


class DictAndIndexRow(dict):
    """
    Row wrapper that supports:
    - row["column_name"]
    - row[index]
    - dict(row)
    - key in row
    """
    def __init__(self, data=None, column_order=None):
        super().__init__(data or {})
        self._column_order = column_order or list(self.keys())

    def __getitem__(self, item):
        if isinstance(item, int):
            col_name = self._column_order[item]
            return super().__getitem__(col_name)
        return super().__getitem__(item)


class PostgresCursorWrapper:
    """
    Wraps a psycopg2 cursor to translate SQLite queries into Postgres:
    - Translates '?' parameter placeholders to '%s'
    - Translates 'INSERT OR IGNORE' to 'ON CONFLICT DO NOTHING'
    - Handles PRAGMA queries gracefully
    - Returns DictAndIndexRow instances
    """
    def __init__(self, cur):
        self._cur = cur

    def _translate(self, query: str):
        q = query.strip()
        # Handle SQLite PRAGMA table_info
        if re.match(r'^PRAGMA\s+table_info\((\w+)\)', q, re.IGNORECASE):
            tbl = re.search(r'PRAGMA\s+table_info\((\w+)\)', q, re.IGNORECASE).group(1).lower()
            return (
                "SELECT column_name as name FROM information_schema.columns WHERE lower(table_name) = %s ORDER BY ordinal_position",
                (tbl,)
            )

        # Ignore generic PRAGMA
        if q.upper().startswith("PRAGMA "):
            return ("SELECT 1;", ())

        # Handle INSERT OR IGNORE INTO
        if re.search(r'\bINSERT\s+OR\s+IGNORE\s+INTO\b', q, re.IGNORECASE):
            q = re.sub(r'\bINSERT\s+OR\s+IGNORE\s+INTO\b', 'INSERT INTO', q, flags=re.IGNORECASE)
            if not re.search(r'\bON\s+CONFLICT\b', q, re.IGNORECASE):
                q = q.rstrip('; ') + ' ON CONFLICT DO NOTHING'

        # Translate SQLite integer boolean comparisons to Postgres booleans
        q = re.sub(r'\b(is_active|voted|mfa_enabled|force_password_reset)\s*=\s*1\b', r'\1 = TRUE', q, flags=re.IGNORECASE)
        q = re.sub(r'\b(is_active|voted|mfa_enabled|force_password_reset)\s*=\s*0\b', r'\1 = FALSE', q, flags=re.IGNORECASE)

        # Translate ? to %s
        q = q.replace('?', '%s')
        return q, None

    def execute(self, query, params=None):
        q, forced_params = self._translate(query)
        p = forced_params if forced_params is not None else params
        if p is not None and not isinstance(p, (tuple, list)):
            p = (p,)
        if p is None:
            return self._cur.execute(q)
        return self._cur.execute(q, p)

    def executemany(self, query, seq_of_params):
        q, _ = self._translate(query)
        return self._cur.executemany(q, seq_of_params)

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        col_names = [desc[0] for desc in self._cur.description] if self._cur.description else []
        return DictAndIndexRow(row, col_names)

    def fetchall(self):
        rows = self._cur.fetchall()
        if not rows:
            return []
        col_names = [desc[0] for desc in self._cur.description] if self._cur.description else []
        return [DictAndIndexRow(r, col_names) for r in rows]

    @property
    def rowcount(self):
        return self._cur.rowcount

    def close(self):
        self._cur.close()


class PostgresConnectionWrapper:
    """
    Wraps psycopg2 connection to mimic sqlite3.Connection methods.
    """
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return PostgresCursorWrapper(self._conn.cursor(cursor_factory=RealDictCursor))

    def execute(self, query, params=None):
        cur = self.cursor()
        cur.execute(query, params)
        return cur

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def is_postgres_configured() -> bool:
    return bool(DATABASE_URL and DATABASE_URL.startswith(("postgres://", "postgresql://")) and PSYCOPG2_AVAILABLE)


def get_db_engine_name() -> str:
    return "postgresql" if is_postgres_configured() else "sqlite"


def is_database_persistent() -> bool:
    if is_postgres_configured():
        return True
    # If running on Render without DATABASE_URL, local disk is ephemeral!
    if os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID"):
        return False
    # Local dev machine SQLite is persistent on user hard drive
    return True


def get_db():
    """
    Provides an active database connection.
    If DATABASE_URL is set and psycopg2 is installed, connects to PostgreSQL.
    Otherwise connects to local SQLite with WAL mode.
    """
    if is_postgres_configured():
        db_url = DATABASE_URL
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        conn = psycopg2.connect(db_url)
        return PostgresConnectionWrapper(conn)

    # SQLite Fallback
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    is_pg = is_postgres_configured()
    bool_true = "TRUE" if is_pg else "1"
    bool_false = "FALSE" if is_pg else "0"

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
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS administrator_accounts (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        role_id TEXT NOT NULL,
        account_status TEXT DEFAULT 'Active',
        mfa_enabled BOOLEAN DEFAULT {bool_false},
        failed_login_attempts INTEGER DEFAULT 0,
        last_login_at TIMESTAMP,
        last_password_change_at TIMESTAMP,
        force_password_reset BOOLEAN DEFAULT {bool_false},
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
        status TEXT DEFAULT 'Draft',
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        timezone TEXT DEFAULT 'Africa/Lagos',
        result_visibility TEXT DEFAULT 'Hidden Until Closed',
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
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS ballot_options (
        id TEXT PRIMARY KEY,
        election_id TEXT NOT NULL,
        party_name TEXT NOT NULL,
        party_acronym TEXT NOT NULL,
        lcd_label TEXT NOT NULL,
        candidate_name TEXT,
        logo_url TEXT,
        display_order INTEGER NOT NULL DEFAULT 1,
        is_active BOOLEAN DEFAULT {bool_true},
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE
    );
    """)

    # 7. Voters Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS voters (
        id TEXT PRIMARY KEY,
        voter_id TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        registration_status TEXT DEFAULT 'Active',
        eligibility_status TEXT DEFAULT 'Eligible',
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
        device_id TEXT UNIQUE NOT NULL,
        device_name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL,
        assigned_election_id TEXT,
        polling_location_id TEXT,
        device_status TEXT DEFAULT 'Active',
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
        voter_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        sensor_slot_id INTEGER NOT NULL,
        finger_label TEXT DEFAULT 'Right Index Finger',
        enrollment_status TEXT DEFAULT 'Enrolled',
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        enrolled_by TEXT,
        revoked_at TIMESTAMP,
        FOREIGN KEY (voter_id) REFERENCES voters(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES terminals(id) ON DELETE CASCADE,
        UNIQUE (device_id, sensor_slot_id)
    );
    """)

    # 10. Voter Participation Records
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS voter_participation (
        id TEXT PRIMARY KEY,
        election_id TEXT NOT NULL,
        voter_id TEXT NOT NULL,
        participation_status TEXT DEFAULT 'Voted',
        voted BOOLEAN DEFAULT {bool_true},
        participation_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        polling_location_id TEXT,
        FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE,
        FOREIGN KEY (voter_id) REFERENCES voters(id) ON DELETE CASCADE,
        UNIQUE (election_id, voter_id)
    );
    """)

    # 11. Anonymous Ballots Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS ballots (
        ballot_id TEXT PRIMARY KEY,
        election_id TEXT NOT NULL,
        selected_option_id TEXT NOT NULL,
        ballot_status TEXT DEFAULT 'Accepted',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE,
        FOREIGN KEY (selected_option_id) REFERENCES ballot_options(id)
    );
    """)

    # 12. Device Commands Queue
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS device_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        command_type TEXT NOT NULL,
        command_parameters TEXT,
        requested_by TEXT,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        command_status TEXT DEFAULT 'Pending',
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
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        event_type TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        result TEXT NOT NULL,
        severity TEXT DEFAULT 'Informational',
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


def export_database_records() -> dict:
    """
    Exports all database tables into a structured dictionary suitable
    for JSON backup and cross-environment migration.
    """
    conn = get_db()
    cursor = conn.cursor()

    tables = [
        "roles", "polling_locations", "elections", "ballot_options",
        "voters", "terminals", "voter_fingerprint_mappings",
        "voter_participation", "ballots", "audit_events", "system_settings"
    ]

    export_data = {
        "export_timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "database_engine": get_db_engine_name(),
        "tables": {}
    }

    for tbl in tables:
        try:
            cursor.execute(f"SELECT * FROM {tbl}")
            rows = [dict(r) for r in cursor.fetchall()]
            # Convert any datetime/timestamp objects to ISO strings
            for r in rows:
                for k, v in r.items():
                    if isinstance(v, (datetime.datetime, datetime.date)):
                        r[k] = v.isoformat()
            export_data["tables"][tbl] = rows
        except Exception as e:
            export_data["tables"][tbl] = []

    conn.close()
    return export_data


def import_database_records(import_data: dict) -> dict:
    """
    Safely merges/restores exported records into the active database.
    Does not duplicate existing records (uses conflict checks).
    """
    conn = get_db()
    cursor = conn.cursor()
    summary = {}

    tables_data = import_data.get("tables", {})

    # 1. Elections
    el_count = 0
    for el in tables_data.get("elections", []):
        cursor.execute("SELECT id FROM elections WHERE id = ?", (el["id"],))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO elections (
                    id, election_code, title, description, election_type, scope,
                    status, starts_at, ends_at, timezone, result_visibility
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                el["id"], el["election_code"], el["title"], el.get("description"),
                el.get("election_type", "General"), el.get("scope", "National"),
                el.get("status", "Draft"), el["starts_at"], el["ends_at"],
                el.get("timezone", "Africa/Lagos"), el.get("result_visibility", "Hidden Until Closed")
            ))
            el_count += 1
    summary["elections_restored"] = el_count

    # 2. Ballot Options
    bo_count = 0
    for bo in tables_data.get("ballot_options", []):
        cursor.execute("SELECT id FROM ballot_options WHERE id = ?", (bo["id"],))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO ballot_options (
                    id, election_id, party_name, party_acronym, lcd_label, candidate_name, display_order, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                bo["id"], bo["election_id"], bo["party_name"], bo["party_acronym"],
                bo["lcd_label"], bo.get("candidate_name"), bo.get("display_order", 1),
                bo.get("is_active", 1)
            ))
            bo_count += 1
    summary["ballot_options_restored"] = bo_count

    # 3. Voters
    v_count = 0
    for v in tables_data.get("voters", []):
        cursor.execute("SELECT id FROM voters WHERE voter_id = ?", (v["voter_id"],))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO voters (
                    id, voter_id, full_name, registration_status, eligibility_status,
                    polling_location_id, registration_source, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                v["id"], v["voter_id"], v["full_name"],
                v.get("registration_status", "Active"), v.get("eligibility_status", "Eligible"),
                v.get("polling_location_id", "loc_lagos_central"),
                v.get("registration_source", "Session Restore"), v.get("notes")
            ))
            v_count += 1
    summary["voters_restored"] = v_count

    # 4. Fingerprint Mappings
    fp_count = 0
    for fp in tables_data.get("voter_fingerprint_mappings", []):
        cursor.execute("SELECT id FROM voter_fingerprint_mappings WHERE voter_id = ? AND device_id = ?", (fp["voter_id"], fp["device_id"]))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO voter_fingerprint_mappings (
                    id, voter_id, device_id, sensor_slot_id, finger_label, enrollment_status
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (
                fp["id"], fp["voter_id"], fp["device_id"],
                fp["sensor_slot_id"], fp.get("finger_label", "Right Index Finger"),
                fp.get("enrollment_status", "Enrolled")
            ))
            fp_count += 1
    summary["fingerprints_restored"] = fp_count

    # 5. Voter Participation
    vp_count = 0
    for vp in tables_data.get("voter_participation", []):
        cursor.execute("SELECT id FROM voter_participation WHERE election_id = ? AND voter_id = ?", (vp["election_id"], vp["voter_id"]))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO voter_participation (
                    id, election_id, voter_id, participation_status, voted
                ) VALUES (?, ?, ?, ?, ?)
            """, (
                vp["id"], vp["election_id"], vp["voter_id"],
                vp.get("participation_status", "Voted"), vp.get("voted", 1)
            ))
            vp_count += 1
    summary["voter_participation_restored"] = vp_count

    # 6. Ballots
    b_count = 0
    for b in tables_data.get("ballots", []):
        cursor.execute("SELECT ballot_id FROM ballots WHERE ballot_id = ?", (b["ballot_id"],))
        if not cursor.fetchone():
            cursor.execute("""
                INSERT INTO ballots (
                    ballot_id, election_id, selected_option_id, ballot_status
                ) VALUES (?, ?, ?, ?)
            """, (
                b["ballot_id"], b["election_id"], b["selected_option_id"],
                b.get("ballot_status", "Accepted")
            ))
            b_count += 1
    summary["ballots_restored"] = b_count

    conn.commit()
    conn.close()
    return summary


if __name__ == "__main__":
    init_db()
    print("Database initialized successfully. Engine:", get_db_engine_name())
