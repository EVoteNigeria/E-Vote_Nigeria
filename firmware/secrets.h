#pragma once

// ========================================================
// NETWORK CREDENTIALS & BACKEND ENDPOINT SECRETS
// Keep this file confidential.
// ========================================================

// Wi-Fi Access Point Credentials
#define WIFI_SSID             "Your_WiFi_SSID"
#define WIFI_PASSWORD         "Your_WiFi_Password"

// Backend Server IP & Port (e.g. your local PC's IP running FastAPI)
#define SERVER_HOST           "http://192.168.1.100:8000"

// REST Endpoints
#define ENDPOINT_HEARTBEAT    "/api/v1/devices/" DEVICE_ID "/heartbeat"
#define ENDPOINT_VOTER_LOOKUP "/api/v1/devices/" DEVICE_ID "/voter-lookup"
#define ENDPOINT_BALLOT_OPTS  "/api/v1/devices/" DEVICE_ID "/ballot-options"
#define ENDPOINT_CAST_BALLOT  "/api/v1/devices/" DEVICE_ID "/cast-ballot"
#define ENDPOINT_ENROLL_RESULT "/api/v1/devices/" DEVICE_ID "/enrollment-result"
