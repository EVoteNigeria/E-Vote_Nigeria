"""
FastAPI Backend Application for Biometric Electronic Voting System.
Provides full REST endpoints for:
1. Administrator Authentication & Profile
2. Overview Statistics & Live Monitoring
3. Election Management & Lifecycle (Draft, Scheduled, Open, Paused, Closed, Certified)
4. Political Party Management (with 16x4 LCD formatting validation)
5. Voter Management (CRUD, CSV Import, Verification)
6. Fingerprint Enrollment Workflow (Device queueing, slot allocation)
7. Terminal Management & Heartbeat Protocol
8. Balloting & Voting Operations (Atomic ACID, Anonymity enforcement, Duplicate rejection)
9. Results & Turnout Monitoring (Strict privacy, reconciliation)
10. Audit Logs & System Settings
"""

import os
import uuid
import json
import csv
import io
import datetime
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, Header, UploadFile, File, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from backend.database import (
    get_db, init_db, get_db_engine_name, is_database_persistent,
    export_database_records, import_database_records
)
from backend.seed import seed_data
from backend.security import (
    verify_password, get_password_hash, create_access_token,
    get_current_admin, require_roles, log_audit_event
)

# Initialize Database Schema & Seed Data if not present
try:
    init_db()
    seed_data()
except Exception as e:
    print(f"[Startup Warning] Database initialization or seeding notice: {e}")

app = FastAPI(
    title="Biometric Electronic Voting System API",
    description="Secured Backend & Device Gateway for Biometric E-Voting System",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_cache_control_header(request, call_next):
    response = await call_next(request)
    path = request.url.path.lower()
    if path.endswith((".html", ".css", ".js")) or path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# ----------------------------------------------------
# Pydantic Request & Response Schemas
# ----------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str

class ElectionCreate(BaseModel):
    election_code: str
    title: str
    description: Optional[str] = None
    election_type: str = "General"
    scope: str = "National"
    starts_at: str
    ends_at: str
    timezone: str = "Africa/Lagos"
    result_visibility: str = "Hidden Until Closed"

class ElectionStatusUpdate(BaseModel):
    status: str # Draft, Scheduled, Open, Paused, Closed, Certified, Archived

class BallotOptionCreate(BaseModel):
    election_id: str
    party_name: str
    party_acronym: str
    lcd_label: str # Max 8 chars
    candidate_name: Optional[str] = None
    display_order: int = 1
    is_active: bool = True

class VoterCreate(BaseModel):
    voter_id: str # Numeric keypad input
    full_name: str
    registration_status: str = "Active"
    eligibility_status: str = "Eligible"
    polling_location_id: Optional[str] = None
    notes: Optional[str] = None

class TerminalRegister(BaseModel):
    device_id: str
    device_name: str
    api_key: str
    assigned_election_id: Optional[str] = None
    polling_location_id: Optional[str] = None

class TerminalHeartbeat(BaseModel):
    device_id: str
    firmware_version: str = "1.0.0"
    wifi_connected: bool = True
    sensor_connected: bool = True
    sensor_slots_used: int = 0
    sensor_slot_capacity: int = 127
    last_error_code: Optional[str] = None

class StartEnrollmentRequest(BaseModel):
    voter_uuid: str
    device_id: str
    finger_label: str = "Right Index Finger"

class MapSlotRequest(BaseModel):
    device_id: str = "ESP32-01"
    sensor_slot_id: int
    finger_label: str = "Right Index Finger"

class RestoreRequest(BaseModel):
    data: dict

class DeviceVoteRequest(BaseModel):
    election_id: str
    voter_id: str
    selected_option_id: str
    fingerprint_slot_id: int
    idempotency_key: Optional[str] = None

# Helper to verify device API Key
def verify_device_credentials(x_device_id: str = Header(None), x_api_key: str = Header(None)):
    if not x_device_id or not x_api_key:
        raise HTTPException(status_code=401, detail="Missing device authentication headers")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM terminals WHERE device_id = ?", (x_device_id,))
    terminal = cursor.fetchone()
    conn.close()
    if not terminal:
        raise HTTPException(status_code=401, detail="Unregistered voting terminal")
    # For security, verify plain key or hash
    if terminal["api_key_hash"] != x_api_key and not verify_password(x_api_key, terminal["api_key_hash"]):
        log_audit_event("Device", "AUTHENTICATION_FAILED", "Failure", f"Device {x_device_id} auth rejected", device_id=x_device_id, severity="Warning")
        raise HTTPException(status_code=401, detail="Invalid terminal credentials")
    return dict(terminal)

# ----------------------------------------------------
# 1. Administrator Authentication Endpoints
# ----------------------------------------------------

@app.post("/api/v1/auth/login")
def login(payload: LoginRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.*, r.name as role_name 
        FROM administrator_accounts a
        JOIN roles r ON a.role_id = r.id
        WHERE a.username = ?
    """, (payload.username,))
    admin = cursor.fetchone()
    
    if not admin:
        conn.close()
        log_audit_event("Administrator", "LOGIN", "Failure", f"Login failed for username: {payload.username}", severity="Warning")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if admin["account_status"] != "Active":
        conn.close()
        raise HTTPException(status_code=403, detail="Account is disabled or locked")
    
    # Check password
    if not verify_password(payload.password, admin["password_hash"]):
        cursor.execute("UPDATE administrator_accounts SET failed_login_attempts = failed_login_attempts + 1 WHERE id = ?", (admin["id"],))
        conn.commit()
        conn.close()
        log_audit_event("Administrator", "LOGIN", "Failure", f"Incorrect password for user: {payload.username}", actor_id=admin["id"], severity="Warning")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    # Successful login
    cursor.execute("""
        UPDATE administrator_accounts 
        SET failed_login_attempts = 0, last_login_at = CURRENT_TIMESTAMP 
        WHERE id = ?
    """, (admin["id"],))
    conn.commit()
    conn.close()
    
    token = create_access_token({"sub": admin["id"], "role": admin["role_name"], "username": admin["username"]})
    log_audit_event("Administrator", "LOGIN", "Success", f"Administrator {admin['username']} logged in", actor_id=admin["id"])
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "admin": {
            "id": admin["id"],
            "full_name": admin["full_name"],
            "username": admin["username"],
            "role": admin["role_name"]
        }
    }

@app.get("/api/v1/auth/me")
def get_profile(current_admin: dict = Depends(get_current_admin)):
    return current_admin

# ----------------------------------------------------
# 2. Overview Dashboard Statistics
# ----------------------------------------------------

@app.get("/api/v1/overview/stats")
def get_overview_stats(election_id: Optional[str] = Query(None), current_admin: dict = Depends(get_current_admin)):
    conn = get_db()
    cursor = conn.cursor()

    # Determine active or selected election
    if election_id:
        cursor.execute("SELECT * FROM elections WHERE id = ?", (election_id,))
    else:
        cursor.execute("SELECT * FROM elections WHERE status IN ('Open', 'Scheduled') ORDER BY created_at DESC LIMIT 1")
    election = cursor.fetchone()
    if not election:
        cursor.execute("SELECT * FROM elections ORDER BY created_at DESC LIMIT 1")
        election = cursor.fetchone()

    total_eligible_voters = 0
    total_voted = 0
    total_ballots = 0
    total_enrolled_fps = 0
    election_dict = dict(election) if election else None

    if election:
        el_id = election["id"]
        # Total registered eligible voters
        cursor.execute("SELECT COUNT(*) as count FROM voters WHERE eligibility_status = 'Eligible' AND registration_status = 'Active'")
        total_eligible_voters = cursor.fetchone()["count"]

        # Total voters with completed fingerprint enrollment
        cursor.execute("SELECT COUNT(DISTINCT voter_id) as count FROM voter_fingerprint_mappings WHERE enrollment_status = 'Enrolled'")
        total_enrolled_fps = cursor.fetchone()["count"]

        # Total voters who voted in this election
        cursor.execute("SELECT COUNT(*) as count FROM voter_participation WHERE election_id = ? AND voted = 1", (el_id,))
        total_voted = cursor.fetchone()["count"]

        # Total accepted ballots in this election
        cursor.execute("SELECT COUNT(*) as count FROM ballots WHERE election_id = ? AND ballot_status = 'Accepted'", (el_id,))
        total_ballots = cursor.fetchone()["count"]

    # Terminals stats
    cursor.execute("""
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN last_heartbeat_at >= datetime('now', '-60 seconds') THEN 1 ELSE 0 END) as online,
            SUM(CASE WHEN device_status = 'Maintenance' THEN 1 ELSE 0 END) as maintenance,
            SUM(CASE WHEN device_status = 'Error' THEN 1 ELSE 0 END) as error
        FROM terminals
    """)
    term_stats = cursor.fetchone()

    # Integrity reconciliation check
    integrity_mismatch = (total_voted != total_ballots)

    conn.close()

    turnout_pct = round((total_voted / total_eligible_voters * 100), 2) if total_eligible_voters > 0 else 0.0

    return {
        "election": election_dict,
        "voter_stats": {
            "total_eligible_voters": total_eligible_voters,
            "total_enrolled_fps": total_enrolled_fps,
            "total_voted": total_voted,
            "remaining_voters": max(0, total_eligible_voters - total_voted),
            "turnout_percentage": turnout_pct,
            "total_accepted_ballots": total_ballots,
            "integrity_mismatch": integrity_mismatch
        },
        "terminal_stats": {
            "total": term_stats["total"] or 0,
            "online": term_stats["online"] or 0,
            "offline": (term_stats["total"] or 0) - (term_stats["online"] or 0),
            "maintenance": term_stats["maintenance"] or 0,
            "error": term_stats["error"] or 0
        }
    }

# ----------------------------------------------------
# 3. Election Management
# ----------------------------------------------------

@app.get("/api/v1/elections")
def list_elections(current_admin: dict = Depends(get_current_admin)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM elections ORDER BY created_at DESC")
    elections = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return elections

@app.post("/api/v1/elections")
def create_election(payload: ElectionCreate, current_admin: dict = Depends(require_roles(["System Administrator", "Election Manager"]))):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM elections WHERE election_code = ?", (payload.election_code,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Election code already exists")

    new_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO elections (
            id, election_code, title, description, election_type, scope,
            status, starts_at, ends_at, timezone, result_visibility, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?)
    """, (
        new_id, payload.election_code, payload.title, payload.description,
        payload.election_type, payload.scope, payload.starts_at, payload.ends_at,
        payload.timezone, payload.result_visibility, current_admin["id"]
    ))
    conn.commit()
    conn.close()

    log_audit_event("Administrator", "CREATE_ELECTION", "Success", f"Created election: {payload.title} ({payload.election_code})", actor_id=current_admin["id"], target_type="Election", target_id=new_id)
    return {"message": "Election created successfully", "id": new_id}

@app.put("/api/v1/elections/{election_id}/status")
def update_election_status(election_id: str, payload: ElectionStatusUpdate, current_admin: dict = Depends(require_roles(["System Administrator", "Election Manager"]))):
    valid_statuses = ['Draft', 'Scheduled', 'Open', 'Paused', 'Closed', 'Certified', 'Archived']
    if payload.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM elections WHERE id = ?", (election_id,))
    election = cursor.fetchone()
    if not election:
        conn.close()
        raise HTTPException(status_code=404, detail="Election not found")

    # State validation
    if payload.status == "Open":
        # Check active parties
        cursor.execute("SELECT COUNT(*) as count FROM ballot_options WHERE election_id = ? AND is_active = 1", (election_id,))
        if cursor.fetchone()["count"] == 0:
            conn.close()
            raise HTTPException(status_code=400, detail="Cannot open election without at least one active political party")

    cursor.execute("""
        UPDATE elections 
        SET status = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
    """, (payload.status, election_id))
    conn.commit()
    conn.close()

    log_audit_event("Administrator", "ELECTION_STATUS_CHANGE", "Success", f"Election {election['election_code']} status changed to {payload.status}", actor_id=current_admin["id"], target_type="Election", target_id=election_id)
    return {"message": f"Election status changed to {payload.status}"}

# ----------------------------------------------------
# 4. Political Party Management (with LCD validation)
# ----------------------------------------------------

@app.get("/api/v1/elections/{election_id}/parties")
def get_parties(election_id: str, current_admin: dict = Depends(get_current_admin)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM ballot_options 
        WHERE election_id = ? 
        ORDER BY display_order ASC, created_at ASC
    """, (election_id,))
    parties = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return parties

@app.post("/api/v1/parties")
def create_party(payload: BallotOptionCreate, current_admin: dict = Depends(require_roles(["System Administrator", "Election Manager"]))):
    # LCD Label validation (Max 8 characters to fit 16x4 LCD column)
    if len(payload.lcd_label.strip()) > 8:
        raise HTTPException(status_code=400, detail="LCD label must be 8 characters or fewer for 16x4 LCD compatibility")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT status FROM elections WHERE id = ?", (payload.election_id,))
    el = cursor.fetchone()
    if not el:
        conn.close()
        raise HTTPException(status_code=404, detail="Election not found")
    if el["status"] not in ["Draft", "Scheduled"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot modify parties after voting has commenced or closed")

    new_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO ballot_options (
            id, election_id, party_name, party_acronym, lcd_label, candidate_name, display_order, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id, payload.election_id, payload.party_name, payload.party_acronym,
        payload.lcd_label.strip(), payload.candidate_name, payload.display_order, payload.is_active
    ))
    conn.commit()
    conn.close()

    log_audit_event("Administrator", "CREATE_PARTY", "Success", f"Created party {payload.party_acronym} ({payload.party_name})", actor_id=current_admin["id"], target_type="Party", target_id=new_id)
    return {"message": "Party created successfully", "id": new_id}

@app.delete("/api/v1/parties/{party_id}")
def delete_party(party_id: str, current_admin: dict = Depends(require_roles(["System Administrator", "Election Manager"]))):
    conn = get_db()
    cursor = conn.cursor()
    # Check if any votes were cast for this option
    cursor.execute("SELECT COUNT(*) as count FROM ballots WHERE selected_option_id = ?", (party_id,))
    if cursor.fetchone()["count"] > 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot delete a party option that already has accepted ballots")

    cursor.execute("DELETE FROM ballot_options WHERE id = ?", (party_id,))
    conn.commit()
    conn.close()
    return {"message": "Party deleted successfully"}

# ----------------------------------------------------
# 5. Voter Management
# ----------------------------------------------------

@app.get("/api/v1/voters")
def list_voters(
    search: Optional[str] = Query(None),
    eligibility: Optional[str] = Query(None),
    registration: Optional[str] = Query(None),
    page: int = 1,
    limit: int = 50,
    current_admin: dict = Depends(get_current_admin)
):
    conn = get_db()
    cursor = conn.cursor()
    query = """
        SELECT v.*, 
               m.sensor_slot_id, m.enrollment_status as fp_status, m.device_id as enrolled_device,
               p.name as polling_location_name
        FROM voters v
        LEFT JOIN voter_fingerprint_mappings m ON v.id = m.voter_id AND m.enrollment_status = 'Enrolled'
        LEFT JOIN polling_locations p ON v.polling_location_id = p.id
        WHERE 1=1
    """
    params = []
    if search:
        query += " AND (v.voter_id LIKE ? OR v.full_name LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    if eligibility:
        query += " AND v.eligibility_status = ?"
        params.append(eligibility)
    if registration:
        query += " AND v.registration_status = ?"
        params.append(registration)

    query += " ORDER BY v.created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, (page - 1) * limit])

    cursor.execute(query, params)
    voters = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return voters

@app.post("/api/v1/voters")
def add_voter(payload: VoterCreate, current_admin: dict = Depends(require_roles(["System Administrator", "Voter Registration Officer"]))):
    # Numeric check
    clean_id = payload.voter_id.strip()
    if not clean_id.isdigit():
        raise HTTPException(status_code=400, detail="Voter ID must be numeric for terminal keypad entry")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM voters WHERE voter_id = ?", (clean_id,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Voter ID already registered")

    new_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO voters (
            id, voter_id, full_name, registration_status, eligibility_status,
            polling_location_id, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id, clean_id, payload.full_name.strip(), payload.registration_status,
        payload.eligibility_status, payload.polling_location_id, payload.notes, current_admin["id"]
    ))
    conn.commit()
    conn.close()

    log_audit_event("Administrator", "REGISTER_VOTER", "Success", f"Registered voter {clean_id} - {payload.full_name}", actor_id=current_admin["id"], target_type="Voter", target_id=new_id)
    return {"message": "Voter registered successfully", "id": new_id, "voter_id": clean_id}

@app.post("/api/v1/voters/import-csv")
async def import_voters_csv(file: UploadFile = File(...), current_admin: dict = Depends(require_roles(["System Administrator", "Voter Registration Officer"]))):
    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    conn = get_db()
    cursor = conn.cursor()
    imported_count = 0
    skipped_count = 0

    for row in reader:
        voter_id = row.get("voter_id", "").strip()
        full_name = row.get("full_name", "").strip()
        if not voter_id or not full_name or not voter_id.isdigit():
            skipped_count += 1
            continue

        cursor.execute("SELECT id FROM voters WHERE voter_id = ?", (voter_id,))
        if cursor.fetchone():
            skipped_count += 1
            continue

        new_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO voters (id, voter_id, full_name, registration_source, created_by)
            VALUES (?, ?, ?, 'CSV Import', ?)
        """, (new_id, voter_id, full_name, current_admin["id"]))
        imported_count += 1

    conn.commit()
    conn.close()

    log_audit_event("Administrator", "CSV_IMPORT_VOTERS", "Success", f"Imported {imported_count} voters, skipped {skipped_count}", actor_id=current_admin["id"])
    return {"imported": imported_count, "skipped": skipped_count}

@app.delete("/api/v1/voters/{voter_id_or_uuid}")
def delete_voter(voter_id_or_uuid: str, current_admin: dict = Depends(require_roles(["System Administrator", "Voter Registration Officer"]))):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM voters WHERE id = ? OR voter_id = ?", (voter_id_or_uuid, voter_id_or_uuid))
    voter = cursor.fetchone()
    if not voter:
        conn.close()
        raise HTTPException(status_code=404, detail="Voter not found")

    voter_uuid = voter["id"]
    numeric_id = voter["voter_id"]
    voter_name = voter["full_name"]

    # Find affected terminals to recalculate their slot counts
    cursor.execute("SELECT DISTINCT device_id FROM voter_fingerprint_mappings WHERE voter_id = ?", (voter_uuid,))
    affected_terminals = [row["device_id"] for row in cursor.fetchall()]

    # Remove biometric mappings and participation records
    cursor.execute("DELETE FROM voter_fingerprint_mappings WHERE voter_id = ?", (voter_uuid,))
    cursor.execute("DELETE FROM voter_participation WHERE voter_id = ?", (voter_uuid,))

    # Delete voter
    cursor.execute("DELETE FROM voters WHERE id = ?", (voter_uuid,))

    # Update sensor slots used for all affected terminals
    for dev_id in affected_terminals:
        cursor.execute("""
            UPDATE terminals SET sensor_slots_used = (
                SELECT COUNT(*) FROM voter_fingerprint_mappings WHERE device_id = ? AND enrollment_status = 'Enrolled'
            ) WHERE id = ? OR device_id = ?
        """, (dev_id, dev_id, dev_id))

    conn.commit()
    conn.close()

    log_audit_event(
        "Administrator",
        "DELETE_VOTER",
        "Success",
        f"Deleted voter {numeric_id} ({voter_name}) and associated biometric mappings",
        actor_id=current_admin["id"],
        target_type="Voter",
        target_id=voter_uuid
    )

    return {
        "message": f"Voter {numeric_id} ({voter_name}) deleted successfully",
        "deleted_id": voter_uuid,
        "voter_id": numeric_id
    }

# ----------------------------------------------------
# 6. Fingerprint Enrollment Workflow
# ----------------------------------------------------

@app.post("/api/v1/fingerprints/start-enrollment")
def start_enrollment(payload: StartEnrollmentRequest, current_admin: dict = Depends(require_roles(["System Administrator", "Voter Registration Officer"]))):
    conn = get_db()
    cursor = conn.cursor()

    # Validate voter
    cursor.execute("SELECT * FROM voters WHERE id = ?", (payload.voter_uuid,))
    voter = cursor.fetchone()
    if not voter:
        conn.close()
        raise HTTPException(status_code=404, detail="Voter not found")

    # Validate terminal
    cursor.execute("SELECT * FROM terminals WHERE id = ? OR device_id = ?", (payload.device_id, payload.device_id))
    terminal = cursor.fetchone()
    if not terminal:
        conn.close()
        raise HTTPException(status_code=404, detail="Voting terminal not found")

    # Allocate next free sensor slot (1 to 127) on this device
    cursor.execute("""
        SELECT sensor_slot_id FROM voter_fingerprint_mappings 
        WHERE device_id = ? AND enrollment_status = 'Enrolled'
        ORDER BY sensor_slot_id ASC
    """, (terminal["id"],))
    occupied_slots = {r["sensor_slot_id"] for r in cursor.fetchall()}

    assigned_slot = None
    for slot in range(1, 128):
        if slot not in occupied_slots:
            assigned_slot = slot
            break

    if not assigned_slot:
        conn.close()
        raise HTTPException(status_code=400, detail="Terminal AS608 sensor memory is full (127 slots maximum)")

    # Enqueue enrollment command for the terminal
    cmd_id = str(uuid.uuid4())
    cmd_params = json.dumps({
        "voter_id": voter["voter_id"],
        "voter_name": voter["full_name"],
        "sensor_slot_id": assigned_slot,
        "finger_label": payload.finger_label
    })

    cursor.execute("""
        INSERT INTO device_commands (id, device_id, command_type, command_parameters, requested_by, command_status)
        VALUES (?, ?, 'ENROLL_FINGERPRINT', ?, ?, 'Pending')
    """, (cmd_id, terminal["id"], cmd_params, current_admin["id"]))

    conn.commit()
    conn.close()

    log_audit_event("Administrator", "START_ENROLLMENT", "Success", f"Enqueued enrollment for voter {voter['voter_id']} on slot {assigned_slot} at terminal {terminal['device_id']}", actor_id=current_admin["id"], device_id=terminal["device_id"])
    return {
        "command_id": cmd_id,
        "assigned_slot": assigned_slot,
        "voter_id": voter["voter_id"],
        "voter_name": voter["full_name"],
        "message": f"Place finger on terminal {terminal['device_name']} to enroll on slot #{assigned_slot}"
    }

# Callback when ESP32 finishes AS608 fingerprint enrollment
@app.post("/api/v1/devices/{device_id}/enrollment-result")
def report_enrollment_result(
    device_id: str,
    payload: dict,
    terminal: dict = Depends(verify_device_credentials)
):
    command_id = payload.get("command_id")
    slot_id = payload.get("sensor_slot_id")
    voter_id_ext = payload.get("voter_id")
    success = payload.get("success", False)
    error_msg = payload.get("error_message")

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM voters WHERE voter_id = ?", (voter_id_ext,))
    voter = cursor.fetchone()
    if not voter:
        conn.close()
        raise HTTPException(status_code=404, detail="Voter not found")

    if success:
        # Revoke any prior mapping for this voter on this device
        cursor.execute("UPDATE voter_fingerprint_mappings SET enrollment_status = 'Revoked' WHERE voter_id = ? AND device_id = ?", (voter["id"], terminal["id"]))
        
        map_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO voter_fingerprint_mappings (
                id, voter_id, device_id, sensor_slot_id, enrollment_status
            ) VALUES (?, ?, ?, ?, 'Enrolled')
        """, (map_id, voter["id"], terminal["id"], slot_id))
        
        # Update command status
        cursor.execute("UPDATE device_commands SET command_status = 'Completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", (command_id,))
        conn.commit()
        log_audit_event("Device", "ENROLLMENT_COMPLETED", "Success", f"Fingerprint enrolled for voter {voter_id_ext} on slot #{slot_id}", device_id=device_id)
    else:
        cursor.execute("UPDATE device_commands SET command_status = 'Failed', error_code = ? WHERE id = ?", (error_msg, command_id))
        conn.commit()
        log_audit_event("Device", "ENROLLMENT_FAILED", "Failure", f"Fingerprint enrollment failed: {error_msg}", device_id=device_id, severity="Warning")

    conn.close()
    return {"status": "Acknowledged"}

# ----------------------------------------------------
# 7. Voting Terminals Management & Protocol
# ----------------------------------------------------

@app.get("/api/v1/terminals")
def list_terminals(current_admin: dict = Depends(get_current_admin)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT t.*, e.title as election_title, p.name as polling_location_name,
               (t.last_heartbeat_at >= datetime('now', '-60 seconds')) as is_online
        FROM terminals t
        LEFT JOIN elections e ON t.assigned_election_id = e.id
        LEFT JOIN polling_locations p ON t.polling_location_id = p.id
        ORDER BY t.registered_at DESC
    """)
    terminals = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return terminals

@app.post("/api/v1/terminals")
def register_terminal(payload: TerminalRegister, current_admin: dict = Depends(require_roles(["System Administrator"]))):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM terminals WHERE device_id = ?", (payload.device_id,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Device ID already registered")

    new_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO terminals (
            id, device_id, device_name, api_key_hash, assigned_election_id, polling_location_id
        ) VALUES (?, ?, ?, ?, ?, ?)
    """, (
        new_id, payload.device_id, payload.device_name, payload.api_key,
        payload.assigned_election_id, payload.polling_location_id
    ))
    conn.commit()
    conn.close()

    log_audit_event("Administrator", "REGISTER_TERMINAL", "Success", f"Registered voting terminal: {payload.device_name} ({payload.device_id})", actor_id=current_admin["id"], target_type="Terminal", target_id=new_id)
    return {"message": "Terminal registered successfully", "id": new_id}

# ESP32 Heartbeat Endpoint
@app.post("/api/v1/devices/{device_id}/heartbeat")
def device_heartbeat(device_id: str, payload: TerminalHeartbeat, terminal: dict = Depends(verify_device_credentials)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE terminals 
        SET last_heartbeat_at = CURRENT_TIMESTAMP,
            firmware_version = ?,
            sensor_slots_used = ?,
            sensor_slot_capacity = ?,
            last_error_code = ?,
            device_status = CASE WHEN ? THEN 'Active' ELSE 'Error' END
        WHERE id = ?
    """, (
        payload.firmware_version,
        payload.sensor_slots_used,
        payload.sensor_slot_capacity,
        payload.last_error_code,
        payload.sensor_connected,
        terminal["id"]
    ))

    # Check for pending commands for this device
    cursor.execute("""
        SELECT * FROM device_commands 
        WHERE device_id = ? AND command_status = 'Pending' 
        ORDER BY requested_at ASC LIMIT 1
    """, (terminal["id"],))
    pending_cmd = cursor.fetchone()

    cmd_data = None
    if pending_cmd:
        cmd_data = {
            "command_id": pending_cmd["id"],
            "command_type": pending_cmd["command_type"],
            "parameters": json.loads(pending_cmd["command_parameters"]) if pending_cmd["command_parameters"] else {}
        }
        cursor.execute("UPDATE device_commands SET command_status = 'Sent' WHERE id = ?", (pending_cmd["id"],))

    conn.commit()
    conn.close()

    return {
        "status": "OK",
        "server_time": datetime.datetime.utcnow().isoformat(),
        "has_command": (cmd_data is not None),
        "command": cmd_data
    }

# ----------------------------------------------------
# 8. Voting Operations (Terminal Hardware Protocol)
# ----------------------------------------------------

# Step A: Terminal queries voter eligibility when Voter ID is typed on keypad
@app.get("/api/v1/devices/{device_id}/voter-lookup")
def voter_lookup(device_id: str, voter_id: str = Query(...), terminal: dict = Depends(verify_device_credentials)):
    clean_voter_id = voter_id.strip()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM voters WHERE voter_id = ?", (clean_voter_id,))
    voter = cursor.fetchone()
    if not voter:
        conn.close()
        log_audit_event("Device", "VOTER_LOOKUP_FAILED", "Failure", f"Unknown voter ID entered on terminal {device_id}", device_id=device_id, severity="Informational")
        return {"status": "INVALID", "message": "Voter ID not registered"}

    if voter["registration_status"] != "Active" or voter["eligibility_status"] != "Eligible":
        conn.close()
        log_audit_event("Device", "VOTER_INELIGIBLE", "Rejected", f"Ineligible voter {clean_voter_id} attempted entry", device_id=device_id, severity="Warning")
        return {"status": "INELIGIBLE", "message": "Voter not eligible"}

    # Check if voter already voted in the assigned election
    election_id = terminal["assigned_election_id"]
    if not election_id:
        conn.close()
        return {"status": "ERROR", "message": "No election assigned to terminal"}

    cursor.execute("SELECT status FROM elections WHERE id = ?", (election_id,))
    el = cursor.fetchone()
    if not el or el["status"] != "Open":
        conn.close()
        return {"status": "ELECTION_CLOSED", "message": f"Election is currently {el['status'] if el else 'Unavailable'}"}

    cursor.execute("SELECT id FROM voter_participation WHERE election_id = ? AND voter_id = ? AND voted = 1", (election_id, voter["id"]))
    if cursor.fetchone():
        conn.close()
        log_audit_event("Device", "DUPLICATE_VOTE_ATTEMPT", "Rejected", f"Voter {clean_voter_id} already voted", device_id=device_id, severity="Warning")
        return {"status": "ALREADY_VOTED", "message": "Already voted in this election"}

    # Fetch biometric slot for this voter on this terminal
    cursor.execute("""
        SELECT sensor_slot_id FROM voter_fingerprint_mappings 
        WHERE voter_id = ? AND device_id = ? AND enrollment_status = 'Enrolled'
    """, (voter["id"], terminal["id"]))
    fp_map = cursor.fetchone()

    if not fp_map:
        conn.close()
        return {"status": "NO_FINGERPRINT", "message": "Fingerprint not enrolled on this terminal"}

    conn.close()
    return {
        "status": "AUTHORIZED_FOR_BIOMETRIC",
        "voter_name": voter["full_name"],
        "expected_sensor_slot_id": fp_map["sensor_slot_id"]
    }

# Step B: Terminal fetches active ballot options (Political Parties) for LCD display
@app.get("/api/v1/devices/{device_id}/ballot-options")
def terminal_ballot_options(device_id: str, terminal: dict = Depends(verify_device_credentials)):
    election_id = terminal["assigned_election_id"]
    if not election_id:
        raise HTTPException(status_code=400, detail="No election assigned to terminal")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, party_acronym, lcd_label, display_order 
        FROM ballot_options 
        WHERE election_id = ? AND is_active = 1
        ORDER BY display_order ASC, created_at ASC
    """, (election_id,))
    options = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {
        "election_id": election_id,
        "total_options": len(options),
        "options": options
    }

# Step C: Terminal submits chosen ballot
# CRITICAL: STRICT TRANSACTION ENFORCEMENT & ANONYMITY (Spec Section 2.3 & 17)
@app.post("/api/v1/devices/{device_id}/cast-ballot")
def cast_ballot(device_id: str, payload: DeviceVoteRequest, terminal: dict = Depends(verify_device_credentials)):
    conn = get_db()
    cursor = conn.cursor()

    try:
        # 1. Validate Election is OPEN
        cursor.execute("SELECT status FROM elections WHERE id = ?", (payload.election_id,))
        el = cursor.fetchone()
        if not el or el["status"] != "Open":
            conn.close()
            return JSONResponse(status_code=400, content={"status": "REJECTED", "message": "Election is not open"})

        # 2. Validate Option exists and belongs to Election
        cursor.execute("SELECT id FROM ballot_options WHERE id = ? AND election_id = ? AND is_active = 1", (payload.selected_option_id, payload.election_id))
        if not cursor.fetchone():
            conn.close()
            return JSONResponse(status_code=400, content={"status": "REJECTED", "message": "Invalid party selection"})

        # 3. Retrieve Voter
        cursor.execute("SELECT id, registration_status, eligibility_status FROM voters WHERE voter_id = ?", (payload.voter_id,))
        voter = cursor.fetchone()
        if not voter or voter["registration_status"] != "Active" or voter["eligibility_status"] != "Eligible":
            conn.close()
            return JSONResponse(status_code=400, content={"status": "REJECTED", "message": "Ineligible voter"})

        # 4. Verify Biometric Slot Match
        cursor.execute("""
            SELECT id FROM voter_fingerprint_mappings 
            WHERE voter_id = ? AND device_id = ? AND sensor_slot_id = ? AND enrollment_status = 'Enrolled'
        """, (voter["id"], terminal["id"], payload.fingerprint_slot_id))
        if not cursor.fetchone():
            conn.close()
            log_audit_event("Device", "BIOMETRIC_MISMATCH", "Rejected", f"Sensor slot {payload.fingerprint_slot_id} does not match voter {payload.voter_id}", device_id=device_id, severity="High")
            return JSONResponse(status_code=400, content={"status": "REJECTED", "message": "Biometric verification failed"})

        # 5. Check duplicate participation
        cursor.execute("SELECT id FROM voter_participation WHERE election_id = ? AND voter_id = ?", (payload.election_id, voter["id"]))
        if cursor.fetchone():
            conn.close()
            return JSONResponse(status_code=400, content={"status": "DUPLICATE", "message": "Ballot already submitted for this voter"})

        # 6. ATOMIC TRANSACTION:
        # A) Insert voter participation record (NO chosen party saved)
        part_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO voter_participation (id, election_id, voter_id, participation_status, voted, polling_location_id)
            VALUES (?, ?, ?, 'Voted', TRUE, ?)
        """, (part_id, payload.election_id, voter["id"], terminal["polling_location_id"]))

        # B) Insert anonymous ballot record (NO voter_id, NO fingerprint_id, NO receipt)
        ballot_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO ballots (ballot_id, election_id, selected_option_id, ballot_status)
            VALUES (?, ?, ?, 'Accepted')
        """, (ballot_id, payload.election_id, payload.selected_option_id))

        conn.commit()

        # Audit event records operational event with NO party-voter link
        log_audit_event("Device", "BALLOT_RECORDED", "Success", f"Ballot recorded at terminal {device_id}", device_id=device_id, severity="Informational")

    except Exception as e:
        conn.rollback()
        conn.close()
        log_audit_event("Device", "BALLOT_TRANSACTION_FAILED", "Failure", f"Transaction rollback: {str(e)}", device_id=device_id, severity="Critical")
        return JSONResponse(status_code=500, content={"status": "ERROR", "message": "Transaction failed"})
    finally:
        conn.close()

    return {
        "status": "ACCEPTED",
        "message": "Vote Recorded Successfully"
    }

# ----------------------------------------------------
# 9. Results & Turnout Monitoring
# ----------------------------------------------------

@app.get("/api/v1/elections/{election_id}/results")
def get_election_results(election_id: str, current_admin: dict = Depends(get_current_admin)):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM elections WHERE id = ?", (election_id,))
    election = cursor.fetchone()
    if not election:
        conn.close()
        raise HTTPException(status_code=404, detail="Election not found")

    # Visibility rules check
    is_closed = election["status"] in ["Closed", "Certified", "Archived"]
    visibility = election["result_visibility"]
    is_admin = current_admin["role_name"] in ["System Administrator", "Election Manager", "Auditor / Observer"]

    if not is_closed:
        if visibility == "Hidden Until Closed" and not is_admin:
            conn.close()
            return {"status": "HIDDEN", "message": "Results are sealed until election closure"}

    # Aggregate counts by party
    cursor.execute("""
        SELECT b.selected_option_id as party_id, 
               p.party_name, p.party_acronym, p.lcd_label, p.candidate_name,
               COUNT(*) as vote_count
        FROM ballots b
        JOIN ballot_options p ON b.selected_option_id = p.id
        WHERE b.election_id = ? AND b.ballot_status = 'Accepted'
        GROUP BY b.selected_option_id, p.party_name, p.party_acronym, p.lcd_label, p.candidate_name
        ORDER BY vote_count DESC
    """, (election_id,))
    results = [dict(row) for row in cursor.fetchall()]

    # Total counts for reconciliation
    cursor.execute("SELECT COUNT(*) as total_ballots FROM ballots WHERE election_id = ? AND ballot_status = 'Accepted'", (election_id,))
    total_ballots = cursor.fetchone()["total_ballots"]

    cursor.execute("SELECT COUNT(*) as total_voters FROM voter_participation WHERE election_id = ? AND voted = 1", (election_id,))
    total_participants = cursor.fetchone()["total_voters"]

    cursor.execute("SELECT COUNT(*) as count FROM voters WHERE eligibility_status = 'Eligible' AND registration_status = 'Active'")
    eligible_count = cursor.fetchone()["count"]

    conn.close()

    # Calculate percentages
    formatted_results = []
    for r in results:
        pct = round((r["vote_count"] / total_ballots * 100), 2) if total_ballots > 0 else 0.0
        r["percentage"] = pct
        formatted_results.append(r)

    reconciled = (total_ballots == total_participants)

    return {
        "election": dict(election),
        "total_eligible_voters": eligible_count,
        "total_participants": total_participants,
        "total_valid_ballots": total_ballots,
        "reconciled": reconciled,
        "turnout_percentage": round((total_participants / eligible_count * 100), 2) if eligible_count > 0 else 0.0,
        "results": formatted_results
    }

# ----------------------------------------------------
# 10. Audit Logs & System Settings Endpoints
# ----------------------------------------------------

@app.get("/api/v1/audit-logs")
def get_audit_logs(
    severity: Optional[str] = Query(None),
    limit: int = 100,
    current_admin: dict = Depends(require_roles(["System Administrator", "Election Manager", "Auditor / Observer"]))
):
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM audit_events WHERE 1=1"
    params = []
    if severity:
        query += " AND severity = ?"
        params.append(severity)
    query += " ORDER BY event_timestamp DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    logs = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return logs

@app.get("/api/v1/settings")
def get_system_settings(current_admin: dict = Depends(get_current_admin)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM system_settings")
    settings = {row["key"]: row["value"] for row in cursor.fetchall()}
    conn.close()
    return settings

# ----------------------------------------------------
# 11. Database Persistence, Backup & Hardware Slot Mapping
# ----------------------------------------------------

@app.get("/api/v1/system/db-status")
def get_db_status(current_admin: dict = Depends(get_current_admin)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as count FROM voters")
    voter_count = cursor.fetchone()["count"]
    cursor.execute("SELECT COUNT(*) as count FROM ballots")
    ballot_count = cursor.fetchone()["count"]
    cursor.execute("SELECT COUNT(*) as count FROM voter_fingerprint_mappings WHERE enrollment_status = 'Enrolled'")
    enrolled_count = cursor.fetchone()["count"]
    conn.close()

    engine = get_db_engine_name()
    persistent = is_database_persistent()
    return {
        "engine": engine,
        "is_persistent": persistent,
        "voter_count": voter_count,
        "ballot_count": ballot_count,
        "enrolled_count": enrolled_count,
        "status_label": "Persistent Cloud Database (PostgreSQL)" if (persistent and engine == "postgresql") else ("Local Persistent SQLite" if persistent else "Ephemeral SQLite (Render Cloud - Data Resets On Sleep)"),
        "guidance": "All data will be saved permanently across reboots." if persistent else "Running on Render with ephemeral disk. To make data permanent, connect a PostgreSQL database via DATABASE_URL or use the automated Backup & Restore tool."
    }

@app.get("/api/v1/system/backup")
def get_database_backup(current_admin: dict = Depends(require_roles(["System Administrator", "Auditor / Observer"]))):
    backup = export_database_records()
    log_audit_event("Administrator", "EXPORT_DATABASE_BACKUP", "Success", "Exported database backup JSON", actor_id=current_admin["id"])
    return backup

@app.post("/api/v1/system/restore")
def restore_database_backup(payload: RestoreRequest, current_admin: dict = Depends(require_roles(["System Administrator"]))):
    try:
        summary = import_database_records(payload.data)
        log_audit_event("Administrator", "RESTORE_DATABASE_BACKUP", "Success", f"Restored database records: {summary}", actor_id=current_admin["id"])
        return {"message": "Database backup restored successfully", "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to restore database: {str(e)}")

@app.post("/api/v1/voters/{voter_id}/map-slot")
def map_voter_slot(voter_id: str, payload: MapSlotRequest, current_admin: dict = Depends(require_roles(["System Administrator", "Voter Registration Officer"]))):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM voters WHERE id = ? OR voter_id = ?", (voter_id, voter_id))
    voter = cursor.fetchone()
    if not voter:
        conn.close()
        raise HTTPException(status_code=404, detail="Voter not found")

    cursor.execute("SELECT * FROM terminals WHERE id = ? OR device_id = ?", (payload.device_id, payload.device_id))
    terminal = cursor.fetchone()
    if not terminal:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Terminal {payload.device_id} not registered")

    # Check if slot already mapped on this terminal to someone else
    cursor.execute("SELECT * FROM voter_fingerprint_mappings WHERE device_id = ? AND sensor_slot_id = ? AND enrollment_status = 'Enrolled'", (terminal["id"], payload.sensor_slot_id))
    existing = cursor.fetchone()
    if existing and existing["voter_id"] != voter["id"]:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Sensor slot #{payload.sensor_slot_id} on {payload.device_id} is already mapped to another voter")

    # Insert or update mapping
    cursor.execute("DELETE FROM voter_fingerprint_mappings WHERE voter_id = ? AND device_id = ?", (voter["id"], terminal["id"]))
    cursor.execute("""
        INSERT INTO voter_fingerprint_mappings (
            id, voter_id, device_id, sensor_slot_id, finger_label, enrollment_status, enrolled_by
        ) VALUES (?, ?, ?, ?, ?, 'Enrolled', ?)
    """, (str(uuid.uuid4()), voter["id"], terminal["id"], payload.sensor_slot_id, payload.finger_label, current_admin["id"]))

    # Update terminal sensor slot count
    cursor.execute("""
        UPDATE terminals SET sensor_slots_used = (
            SELECT COUNT(*) FROM voter_fingerprint_mappings WHERE device_id = ? AND enrollment_status = 'Enrolled'
        ) WHERE id = ?
    """, (terminal["id"], terminal["id"]))

    conn.commit()
    conn.close()

    log_audit_event("Administrator", "LINK_BIOMETRIC_SLOT", "Success", f"Directly linked voter {voter['voter_id']} to AS608 Slot #{payload.sensor_slot_id} on {payload.device_id}", actor_id=current_admin["id"], target_type="Voter", target_id=voter["id"])
    return {
        "message": f"Successfully mapped voter {voter['voter_id']} ({voter['full_name']}) to sensor slot #{payload.sensor_slot_id}",
        "voter_id": voter["voter_id"],
        "slot_id": payload.sensor_slot_id
    }

# Mount Frontend Dashboard Static Files
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
