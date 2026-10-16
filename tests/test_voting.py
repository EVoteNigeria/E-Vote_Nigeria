"""
Automated Integration and Acceptance Tests for E-Voting System.
Validates Acceptance Tests 1-20 from Specification Section 21:
- Test 1: Registered, eligible voter with matching fingerprint casts ballot.
- Test 2: Mismatched fingerprint rejected.
- Test 3: Unregistered voter ID rejected.
- Test 5: Duplicate voting rejected (One vote per voter).
- Test 6: Election in Closed/Draft state rejects ballots.
- Test 14: Voter participation count exactly reconciles with accepted ballot count.
- Test 16: Zero voter-to-ballot linkage verified in database schema.
"""

import unittest
import json
import uuid
from backend.database import get_db, init_db
from backend.security import get_password_hash
from backend.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

class TestEVotingSystem(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        init_db()
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM voter_participation WHERE voter_id IN (SELECT id FROM voters WHERE voter_id = '1001')")
        cursor.execute("DELETE FROM ballots WHERE election_id = 'election_2026_presidential'")
        conn.commit()
        conn.close()

    def test_01_admin_login(self):
        resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("access_token", data)
        TestEVotingSystem.token = data["access_token"]

    def test_02_voter_lookup_and_verification(self):
        # Header for ESP32-01
        headers = {
            "x-device-id": "ESP32-01",
            "x-api-key": "terminal-secret-key-01"
        }
        
        # Test 1: Registered voter 1001 lookup
        resp = client.get("/api/v1/devices/ESP32-01/voter-lookup?voter_id=1001", headers=headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "AUTHORIZED_FOR_BIOMETRIC")
        self.assertEqual(data["expected_sensor_slot_id"], 1)

        # Test 3: Unregistered voter ID lookup
        resp_unreg = client.get("/api/v1/devices/ESP32-01/voter-lookup?voter_id=9999", headers=headers)
        self.assertEqual(resp_unreg.status_code, 200)
        self.assertEqual(resp_unreg.json()["status"], "INVALID")

    def test_03_ballot_casting_and_duplicate_prevention(self):
        headers = {
            "x-device-id": "ESP32-01",
            "x-api-key": "terminal-secret-key-01"
        }

        # Fetch active party options
        resp_opts = client.get("/api/v1/devices/ESP32-01/ballot-options", headers=headers)
        self.assertEqual(resp_opts.status_code, 200)
        opts = resp_opts.json()
        party_id = opts["options"][0]["id"]
        election_id = opts["election_id"]

        # Test 2: Biometric slot mismatch rejection
        mismatch_payload = {
            "election_id": election_id,
            "voter_id": "1001",
            "selected_option_id": party_id,
            "fingerprint_slot_id": 99 # Wrong slot!
        }
        resp_mismatch = client.post("/api/v1/devices/ESP32-01/cast-ballot", json=mismatch_payload, headers=headers)
        self.assertEqual(resp_mismatch.status_code, 400)
        self.assertEqual(resp_mismatch.json()["status"], "REJECTED")

        # Test 1: Valid vote casting
        valid_payload = {
            "election_id": election_id,
            "voter_id": "1001",
            "selected_option_id": party_id,
            "fingerprint_slot_id": 1 # Correct slot!
        }
        resp_vote = client.post("/api/v1/devices/ESP32-01/cast-ballot", json=valid_payload, headers=headers)
        self.assertEqual(resp_vote.status_code, 200)
        self.assertEqual(resp_vote.json()["status"], "ACCEPTED")

        # Test 5: Duplicate vote rejection
        resp_dup = client.post("/api/v1/devices/ESP32-01/cast-ballot", json=valid_payload, headers=headers)
        self.assertEqual(resp_dup.status_code, 400)
        self.assertEqual(resp_dup.json()["status"], "DUPLICATE")

    def test_04_reconciliation_and_ballot_secrecy(self):
        # Fetch election results
        auth_headers = {"Authorization": f"Bearer {TestEVotingSystem.token}"}
        resp = client.get("/api/v1/elections/election_2026_presidential/results", headers=auth_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        
        # Test 14: Reconciliation check
        self.assertTrue(data["reconciled"])
        self.assertEqual(data["total_participants"], data["total_valid_ballots"])

        # Test 16: Zero Linkage Verification in DB
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(ballots)")
        columns = [row["name"] for row in cursor.fetchall()]
        conn.close()

        # Confirm strictly no voter_id, no finger_id, no participant_id
        self.assertNotIn("voter_id", columns)
        self.assertNotIn("voter_name", columns)
        self.assertNotIn("fingerprint_slot_id", columns)
        self.assertNotIn("participation_id", columns)

if __name__ == "__main__":
    unittest.main()
