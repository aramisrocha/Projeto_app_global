from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError

import base64
import boto3
import hmac
import json
import os
import urllib.request


app = FastAPI(title="Registro de Ponto - Global Lab")


# The API CloudFront (with WAF) adds X-Origin-Verify with a shared secret. Requests without it
# reached the regional API Gateway directly, bypassing the WAF, so they are rejected.
# /health stays open: the ALB and the Route 53 health checks call it directly.
ORIGIN_VERIFY_SECRET = os.getenv("ORIGIN_VERIFY_SECRET", "")
OPEN_PATHS = {"/health"}


@app.middleware("http")
async def verify_origin(request: Request, call_next):
    if ORIGIN_VERIFY_SECRET and request.url.path not in OPEN_PATHS:
        received = request.headers.get("x-origin-verify", "")
        if not hmac.compare_digest(received, ORIGIN_VERIFY_SECRET):
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def detect_region() -> str:
    """Region the task runs in, so each region uses its local DynamoDB Global Tables replica
    instead of crossing the ocean. Order: env vars, then the ECS task metadata endpoint
    (the AZ, e.g. eu-west-1a, minus its last letter), then us-east-1 for local runs."""
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION")
    if region:
        return region
    metadata_uri = os.getenv("ECS_CONTAINER_METADATA_URI_V4")
    if metadata_uri:
        try:
            with urllib.request.urlopen(f"{metadata_uri}/task", timeout=2) as resp:
                az = json.load(resp).get("AvailabilityZone", "")
            if az:
                return az[:-1]
        except (OSError, ValueError):
            pass
    return "us-east-1"


AWS_REGION = detect_region()

# Optional, for local tests against DynamoDB Local (e.g. http://localhost:8000)
DYNAMODB_ENDPOINT = os.getenv("DYNAMODB_ENDPOINT") or None

EMPLOYEES_TABLE = os.environ["EMPLOYEES_TABLE"]
CLOCK_TABLE = os.environ["CLOCK_TABLE"]

# Sync routes run in a thread pool (40 threads by default), so the connection pool must be larger
# than boto3's default of 10, or threads queue waiting for a connection under load.
# Adaptive retries back off on throttling instead of failing the request.
BOTO_CONFIG = Config(
    max_pool_connections=50,
    retries={"max_attempts": 5, "mode": "adaptive"},
)

dynamodb = boto3.resource(
    "dynamodb",
    region_name=AWS_REGION,
    endpoint_url=DYNAMODB_ENDPOINT,
    config=BOTO_CONFIG,
)
employees_table = dynamodb.Table(EMPLOYEES_TABLE)
clock_table = dynamodb.Table(CLOCK_TABLE)


# ==== MODELOS ====

class EmployeeCreate(BaseModel):
    id: str
    name: str
    email: str
    timezone: str = "America/Sao_Paulo"


class Employee(BaseModel):
    id: str
    name: str
    email: str
    timezone: str


class EmployeePage(BaseModel):
    items: List[Employee]
    next_token: Optional[str] = None


class ClockCreate(BaseModel):
    employeeId: str
    type: str  # "IN" ou "OUT"


class ClockRecord(BaseModel):
    employeeId: str
    timestampUtc: str
    type: str


# ==== PAGINAÇÃO ====

def encode_token(last_key: Optional[dict]) -> Optional[str]:
    """Turns DynamoDB's LastEvaluatedKey into an opaque token for the client."""
    if not last_key:
        return None
    return base64.urlsafe_b64encode(json.dumps(last_key).encode()).decode()


def decode_token(token: str) -> dict:
    try:
        key = json.loads(base64.urlsafe_b64decode(token.encode()))
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Invalid next_token")
    if not isinstance(key, dict) or set(key) != {"id"}:
        raise HTTPException(status_code=400, detail="Invalid next_token")
    return key


# ==== ROTAS DE FUNCIONÁRIO ====

@app.post("/employees", response_model=Employee)
def create_employee(emp: EmployeeCreate):
    # One conditional write instead of a read followed by a write:
    # half the calls, and no race between two requests with the same ID
    item = emp.dict()
    try:
        employees_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(id)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HTTPException(status_code=400, detail="Employee ID already exists")
        raise
    return item


@app.get("/employees", response_model=EmployeePage)
def list_employees(
    limit: int = Query(50, ge=1, le=100),
    next_token: Optional[str] = None,
):
    # Paginated: each call reads at most `limit` items, so its cost and latency
    # stay the same no matter how large the table grows
    kwargs = {"Limit": limit}
    if next_token:
        kwargs["ExclusiveStartKey"] = decode_token(next_token)

    resp = employees_table.scan(**kwargs)
    return {
        "items": resp.get("Items", []),
        "next_token": encode_token(resp.get("LastEvaluatedKey")),
    }


# ==== ROTAS DE REGISTRO DE PONTO ====

@app.post("/clock", response_model=ClockRecord)
def register_clock(clock: ClockCreate):
    if clock.type not in ("IN", "OUT"):
        raise HTTPException(status_code=400, detail="type must be 'IN' or 'OUT'")

    # Verifica se o funcionário existe
    emp_resp = employees_table.get_item(Key={"id": clock.employeeId})
    if "Item" not in emp_resp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Timestamp em UTC
    now_utc = datetime.now(timezone.utc).isoformat()

    item = {
        "employeeId": clock.employeeId,
        "timestampUtc": now_utc,
        "type": clock.type,
    }

    clock_table.put_item(Item=item)
    return item


@app.get("/clock/{employee_id}", response_model=List[ClockRecord])
def list_clock_records(employee_id: str):
    # Query by partition key, most recent first: always reads at most 20 items
    resp = clock_table.query(
        KeyConditionExpression=Key("employeeId").eq(employee_id),
        Limit=20,
        ScanIndexForward=False,
    )
    return resp.get("Items", [])


@app.get("/health")
def health():
    return {"status": "ok", "region": AWS_REGION}
