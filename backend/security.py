"""
Security and Authentication Utilities for E-Voting System.
- Password hashing with bcrypt.
- JWT token generation and validation.
- Audit event logging helper.
"""

import os
import uuid
import datetime
import jwt
import bcrypt
from fastapi import HTTPException, Security, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.database import get_db

SECRET_KEY = os.environ.get("VOTE_JWT_SECRET", "super-secret-evote-cryptographic-key-lagos-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480 # 8 hours

security = HTTPBearer(auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def create_access_token(data: dict, expires_delta: datetime.timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.utcnow() + expires_delta
    else:
        expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def log_audit_event(
    actor_type: str,
    event_type: str,
    result: str,
    sanitized_description: str,
    actor_id: str = None,
    target_type: str = None,
    target_id: str = None,
    severity: str = "Informational",
    reason_code: str = None,
    device_id: str = None,
    correlation_id: str = None
):
    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO audit_events (
                id, actor_type, actor_id, event_type, target_type, target_id,
                result, severity, reason_code, device_id, correlation_id, sanitized_description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            str(uuid.uuid4()), actor_type, actor_id, event_type, target_type, target_id,
            result, severity, reason_code, device_id, correlation_id, sanitized_description
        ))
        conn.commit()
    finally:
        conn.close()

def get_current_admin(credentials: HTTPAuthorizationCredentials = Security(security)):
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        admin_id: str = payload.get("sub")
        if admin_id is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.*, r.name as role_name 
        FROM administrator_accounts a
        JOIN roles r ON a.role_id = r.id
        WHERE a.id = ? AND a.account_status = 'Active'
    """, (admin_id,))
    admin = cursor.fetchone()
    conn.close()

    if not admin:
        raise HTTPException(status_code=401, detail="Admin account inactive or not found")
    return dict(admin)

def require_roles(allowed_roles: list):
    def role_checker(current_admin: dict = Depends(get_current_admin)):
        if current_admin["role_name"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires one of the roles: {', '.join(allowed_roles)}"
            )
        return current_admin
    return role_checker
