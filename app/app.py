from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, List, Optional
from datetime import datetime, timezone
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

import base64
import boto3
import json
import os
import re
import urllib.request


app = FastAPI(title="Ativos Global - Controle de ativos corporativos")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AWS_REGION = os.environ["AWS_REGION"]
DYNAMODB_ENDPOINT = os.getenv("DYNAMODB_ENDPOINT")

# Single-table design on the global table (replicated between us-east-1 and eu-west-1):
#   PK="ASSET"        SK="ASSET#<id>"         -> asset (listed with one Query, no scan)
#   PK="ASSET#<id>"   SK="EVENT#<timestamp>"  -> history of one asset
#   PK="FEED"         SK="<timestamp>#<id>"   -> latest events of all assets
ASSETS_TABLE = os.getenv("ASSETS_TABLE", "app-global-prd-points")

dynamodb = boto3.resource(
    "dynamodb",
    region_name=AWS_REGION,
    endpoint_url=DYNAMODB_ENDPOINT if DYNAMODB_ENDPOINT else None,
)
table = dynamodb.Table(ASSETS_TABLE)
# Low-level client for transactions; the resource's own client would serialize the values twice
client = boto3.client(
    "dynamodb",
    region_name=AWS_REGION,
    endpoint_url=DYNAMODB_ENDPOINT if DYNAMODB_ENDPOINT else None,
)
serializer = TypeSerializer()

print("AWS_REGION =", AWS_REGION)
print("ASSETS_TABLE =", ASSETS_TABLE)

# Friendly names shown by the frontend region indicator
REGION_NAMES = {
    "us-east-1": "N. Virginia",
    "eu-west-1": "Irlanda",
}


def detect_availability_zone():
    # ECS task metadata endpoint v4 reports the AZ where this Fargate task runs
    metadata_uri = os.getenv("ECS_CONTAINER_METADATA_URI_V4")
    if not metadata_uri:
        return None
    try:
        with urllib.request.urlopen(f"{metadata_uri}/task", timeout=2) as resp:
            return json.load(resp).get("AvailabilityZone")
    except Exception:
        return None


AVAILABILITY_ZONE = detect_availability_zone()
print("AVAILABILITY_ZONE =", AVAILABILITY_ZONE)


# ==== DOMAIN ====

CATEGORIES = ["NOTEBOOK", "MONITOR", "SERVER", "PHONE", "NETWORK", "LICENSE"]
SITES = ["São Paulo", "Nova York", "Dublin", "Lisboa", "Londres"]
STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"]

# Allowed transitions: action -> (statuses it can start from, resulting status, event type)
ACTIONS = {
    "ASSIGN": ({"AVAILABLE"}, "IN_USE", "ASSIGNED"),
    "RETURN": ({"IN_USE", "MAINTENANCE"}, "AVAILABLE", "RETURNED"),
    "MAINTENANCE": ({"AVAILABLE", "IN_USE"}, "MAINTENANCE", "MAINTENANCE"),
    "RETIRE": ({"AVAILABLE", "MAINTENANCE"}, "RETIRED", "RETIRED"),
}

ASSET_ID_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,23}$")


class AssetCreate(BaseModel):
    id: str = Field(description="Tag patrimonial, ex: NB-0001")
    name: str
    category: str
    serialNumber: str
    site: str
    costUsd: float = Field(ge=0)


class Asset(BaseModel):
    id: str
    name: str
    category: str
    serialNumber: str
    site: str
    costUsd: float
    status: str
    assignee: Optional[str] = None
    version: int
    createdAt: str
    updatedAt: str
    updatedBy: Optional[str] = None
    updatedRegion: Optional[str] = None


class AssetAction(BaseModel):
    action: str
    assignee: Optional[str] = None
    note: Optional[str] = None
    # Version the user saw; protects against two people changing the same asset at once
    expectedVersion: int


class AssetEvent(BaseModel):
    assetId: str
    assetName: Optional[str] = None
    type: str
    fromStatus: Optional[str] = None
    toStatus: str
    assignee: Optional[str] = None
    note: Optional[str] = None
    actor: Optional[str] = None
    region: str
    timestampUtc: str


class AssetDetail(BaseModel):
    asset: Asset
    history: List[AssetEvent]


class Dashboard(BaseModel):
    total: int
    totalValueUsd: float
    utilizationRate: float
    byStatus: Dict[str, int]
    byCategory: Dict[str, int]
    bySite: Dict[str, int]
    recentEvents: List[AssetEvent]


# ==== HELPERS ====

def now_utc():
    return datetime.now(timezone.utc).isoformat()


def current_user(request: Request):
    # The API Gateway already validated the JWT; here we only read who is acting
    auth = request.headers.get("authorization", "")
    try:
        payload = auth.split(" ")[1].split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return claims.get("email") or claims.get("cognito:username")
    except Exception:
        return None


def to_asset(item):
    return {
        **{k: v for k, v in item.items() if k not in ("PK", "SK")},
        "costUsd": float(item.get("costUsd", 0)),
        "version": int(item.get("version", 0)),
    }


def to_event(item):
    return {k: v for k, v in item.items() if k not in ("PK", "SK")}


def put(item):
    return {"Put": {"TableName": ASSETS_TABLE, "Item": {k: serializer.serialize(v) for k, v in item.items()}}}


def event_items(event):
    # The same event is written twice: in the asset history and in the global feed
    return [
        put({"PK": f"ASSET#{event['assetId']}", "SK": f"EVENT#{event['timestampUtc']}", **event}),
        put({"PK": "FEED", "SK": f"{event['timestampUtc']}#{event['assetId']}", **event}),
    ]


def get_asset_item(asset_id: str):
    item = table.get_item(Key={"PK": "ASSET", "SK": f"ASSET#{asset_id}"}).get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")
    return item


def list_asset_items():
    items, kwargs = [], {"KeyConditionExpression": Key("PK").eq("ASSET")}
    while True:
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            return items
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def recent_events(limit: int):
    resp = table.query(KeyConditionExpression=Key("PK").eq("FEED"), ScanIndexForward=False, Limit=limit)
    return [to_event(i) for i in resp.get("Items", [])]


def transaction_failed(err: ClientError):
    return err.response["Error"]["Code"] == "TransactionCanceledException"


# ==== ROUTES ====

@app.get("/dashboard", response_model=Dashboard)
def dashboard():
    assets = [to_asset(i) for i in list_asset_items()]
    active = [a for a in assets if a["status"] != "RETIRED"]
    by_status = {s: 0 for s in STATUSES}
    by_category = {c: 0 for c in CATEGORIES}
    by_site = {s: 0 for s in SITES}
    for a in assets:
        by_status[a["status"]] = by_status.get(a["status"], 0) + 1
        if a["status"] != "RETIRED":
            by_category[a["category"]] = by_category.get(a["category"], 0) + 1
            by_site[a["site"]] = by_site.get(a["site"], 0) + 1

    in_use = by_status["IN_USE"]
    return {
        "total": len(active),
        "totalValueUsd": round(sum(a["costUsd"] for a in active), 2),
        "utilizationRate": round(in_use / len(active), 4) if active else 0,
        "byStatus": by_status,
        "byCategory": by_category,
        "bySite": by_site,
        "recentEvents": recent_events(6),
    }


@app.get("/assets", response_model=List[Asset])
def list_assets(status: Optional[str] = None, category: Optional[str] = None, site: Optional[str] = None, q: Optional[str] = None):
    assets = [to_asset(i) for i in list_asset_items()]
    if status:
        assets = [a for a in assets if a["status"] == status]
    if category:
        assets = [a for a in assets if a["category"] == category]
    if site:
        assets = [a for a in assets if a["site"] == site]
    if q:
        term = q.lower()
        assets = [
            a for a in assets
            if term in " ".join([a["id"], a["name"], a["serialNumber"], a.get("assignee") or ""]).lower()
        ]
    return sorted(assets, key=lambda a: a["id"])


@app.post("/assets", response_model=Asset, status_code=201)
def create_asset(body: AssetCreate, request: Request):
    asset_id = body.id.strip().upper()
    if not ASSET_ID_PATTERN.match(asset_id):
        raise HTTPException(status_code=400, detail="Tag inválida: use letras, números e hífen, ex: NB-0001.")
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoria inválida.")
    if body.site not in SITES:
        raise HTTPException(status_code=400, detail="Site inválido.")

    ts = now_utc()
    actor = current_user(request)
    asset = {
        "id": asset_id,
        "name": body.name.strip(),
        "category": body.category,
        "serialNumber": body.serialNumber.strip(),
        "site": body.site,
        "costUsd": Decimal(str(body.costUsd)),
        "status": "AVAILABLE",
        "version": 1,
        "createdAt": ts,
        "updatedAt": ts,
        "updatedBy": actor,
        "updatedRegion": AWS_REGION,
    }
    event = {
        "assetId": asset_id,
        "assetName": asset["name"],
        "type": "CREATED",
        "toStatus": "AVAILABLE",
        "actor": actor,
        "region": AWS_REGION,
        "timestampUtc": ts,
    }

    # Asset and its first event are written together, or not at all
    asset_put = put({"PK": "ASSET", "SK": f"ASSET#{asset_id}", **asset})
    asset_put["Put"]["ConditionExpression"] = "attribute_not_exists(PK)"
    try:
        client.transact_write_items(TransactItems=[asset_put, *event_items(event)])
    except ClientError as err:
        if transaction_failed(err):
            raise HTTPException(status_code=409, detail=f"Já existe um ativo com a tag {asset_id}.")
        raise
    return to_asset(asset)


@app.get("/assets/{asset_id}", response_model=AssetDetail)
def get_asset(asset_id: str):
    asset = to_asset(get_asset_item(asset_id))
    resp = table.query(
        KeyConditionExpression=Key("PK").eq(f"ASSET#{asset_id}") & Key("SK").begins_with("EVENT#"),
        ScanIndexForward=False,
        Limit=50,
    )
    return {"asset": asset, "history": [to_event(i) for i in resp.get("Items", [])]}


@app.post("/assets/{asset_id}/actions", response_model=Asset)
def change_asset(asset_id: str, body: AssetAction, request: Request):
    if body.action not in ACTIONS:
        raise HTTPException(status_code=400, detail="Ação inválida.")
    allowed_from, new_status, event_type = ACTIONS[body.action]

    current = get_asset_item(asset_id)
    if current["status"] not in allowed_from:
        raise HTTPException(status_code=409, detail="Essa ação não é permitida no status atual do ativo.")
    assignee = (body.assignee or "").strip() or None
    if body.action == "ASSIGN" and not assignee:
        raise HTTPException(status_code=400, detail="Informe para quem o ativo será atribuído.")
    if new_status != "IN_USE":
        assignee = None

    ts = now_utc()
    actor = current_user(request)
    new_version = body.expectedVersion + 1

    # Optimistic locking: the update only applies if nobody changed the asset since the user read it
    update = {
        "Update": {
            "TableName": ASSETS_TABLE,
            "Key": {"PK": {"S": "ASSET"}, "SK": {"S": f"ASSET#{asset_id}"}},
            "UpdateExpression": "SET #status = :status, assignee = :assignee, version = :new, "
                                "updatedAt = :ts, updatedBy = :actor, updatedRegion = :region",
            "ConditionExpression": "version = :expected",
            "ExpressionAttributeNames": {"#status": "status"},
            "ExpressionAttributeValues": {
                k: serializer.serialize(v) for k, v in {
                    ":status": new_status,
                    ":assignee": assignee,
                    ":new": new_version,
                    ":expected": body.expectedVersion,
                    ":ts": ts,
                    ":actor": actor,
                    ":region": AWS_REGION,
                }.items()
            },
        }
    }
    event = {
        "assetId": asset_id,
        "assetName": current.get("name"),
        "type": event_type,
        "fromStatus": current["status"],
        "toStatus": new_status,
        "assignee": assignee or current.get("assignee"),
        "note": (body.note or "").strip() or None,
        "actor": actor,
        "region": AWS_REGION,
        "timestampUtc": ts,
    }
    try:
        client.transact_write_items(TransactItems=[update, *event_items(event)])
    except ClientError as err:
        if transaction_failed(err):
            raise HTTPException(status_code=409, detail="O ativo foi alterado por outra pessoa. Atualize e tente de novo.")
        raise

    return to_asset({**current, "status": new_status, "assignee": assignee, "version": new_version,
                     "updatedAt": ts, "updatedBy": actor, "updatedRegion": AWS_REGION})


@app.get("/events", response_model=List[AssetEvent])
def list_events(limit: int = 30):
    return recent_events(min(max(limit, 1), 100))


@app.get("/health")
def health():
    # Public route: used by ALB/Route 53 health checks and by the frontend region indicator
    return {
        "status": "ok",
        "region": AWS_REGION,
        "regionName": REGION_NAMES.get(AWS_REGION, AWS_REGION),
        "availabilityZone": AVAILABILITY_ZONE,
    }
