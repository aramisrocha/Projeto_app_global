from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key

import boto3
import json
import os
import urllib.request


app = FastAPI(title="Registro de Ponto - Global Lab")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Nome das tabelas (pode vir de variável de ambiente no ECS)
#EMPLOYEES_TABLE = os.getenv("EMPLOYEES_TABLE", "Employees")
#CLOCK_TABLE = os.getenv("CLOCK_TABLE", "ClockRecords")

#AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_REGION = os.environ["AWS_REGION"]
DYNAMODB_ENDPOINT = os.getenv("DYNAMODB_ENDPOINT")  

#EMPLOYEES_TABLE = os.environ["EMPLOYEES_TABLE"]
#CLOCK_TABLE = os.environ["CLOCK_TABLE"]
#endpoint = os.getenv("DYNAMODB_ENDPOINT")

#dynamodb = boto3.resource("dynamodb")


#EMPLOYEES_TABLE = os.getenv("EMPLOYEES_TABLE", "EMPLOYEES_TABLE")
EMPLOYEES_TABLE = os.getenv("app-global-prd-employees", "app-global-prd-employees")
#CLOCK_TABLE = os.getenv("CLOCK_TABLE", "CLOCK_TABLE")
CLOCK_TABLE = os.getenv("app-global-prd-clock", "app-global-prd-clock")
dynamodb = boto3.resource(
    "dynamodb",
    #endpoint_url="http://192.168.10.100:8000",
    #endpoint_url= "DYNAMODB_ENDPOINT",
    region_name=AWS_REGION,
    #aws_access_key_id="dummy",
    #aws_secret_access_key="dummy",
    endpoint_url=DYNAMODB_ENDPOINT if DYNAMODB_ENDPOINT else None,
)


employees_table = dynamodb.Table(EMPLOYEES_TABLE)
clock_table = dynamodb.Table(CLOCK_TABLE)

#app = FastAPI(title="Registro de Ponto - Global Lab")

print("AWS_REGION =", AWS_REGION)
print("DYNAMODB_ENDPOINT =", DYNAMODB_ENDPOINT)
print("EMPLOYEES_TABLE =", EMPLOYEES_TABLE)
print("CLOCK_TABLE =", CLOCK_TABLE)

sts = boto3.client("sts", region_name=AWS_REGION)
print("CALLER_IDENTITY =", sts.get_caller_identity())

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


class ClockCreate(BaseModel):
    employeeId: str
    # "IN" ou "OUT"; quando omitido, alterna a partir do último registro
    type: Optional[str] = None


class ClockRecord(BaseModel):
    employeeId: str
    timestampUtc: str
    type: str
    # Região onde o ponto foi registrado (registros antigos não têm)
    region: Optional[str] = None
    employeeName: Optional[str] = None


# ==== ROTAS DE FUNCIONÁRIO ====

@app.post("/employees", response_model=Employee)
def create_employee(emp: EmployeeCreate):
    # Verifica se já existe
    resp = employees_table.get_item(Key={"id": emp.id})
    if "Item" in resp:
        raise HTTPException(status_code=400, detail="Employee ID already exists")

    item = emp.dict()
    employees_table.put_item(Item=item)
    return item


@app.get("/employees", response_model=List[Employee])
def list_employees():
    resp = employees_table.scan()
    items = resp.get("Items", [])
    return sorted(items, key=lambda e: e.get("name", "").lower())


# ==== ROTAS DE REGISTRO DE PONTO ====

def last_clock_record(employee_id: str):
    resp = clock_table.query(
        KeyConditionExpression=Key("employeeId").eq(employee_id),
        Limit=1,
        ScanIndexForward=False,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


@app.post("/clock", response_model=ClockRecord)
def register_clock(clock: ClockCreate):
    # Verifica se o funcionário existe
    emp_resp = employees_table.get_item(Key={"id": clock.employeeId})
    if "Item" not in emp_resp:
        raise HTTPException(status_code=404, detail="Employee not found")

    record_type = clock.type
    if record_type is None:
        # Alterna: depois de uma entrada vem uma saída, e vice-versa
        last = last_clock_record(clock.employeeId)
        record_type = "OUT" if last and last.get("type") == "IN" else "IN"

    if record_type not in ("IN", "OUT"):
        raise HTTPException(status_code=400, detail="type must be 'IN' or 'OUT'")

    # Timestamp em UTC
    now_utc = datetime.now(timezone.utc).isoformat()

    item = {
        "employeeId": clock.employeeId,
        "timestampUtc": now_utc,
        "type": record_type,
        "region": AWS_REGION,
    }

    clock_table.put_item(Item=item)
    return {**item, "employeeName": emp_resp["Item"].get("name")}


@app.get("/clock", response_model=List[ClockRecord])
def list_recent_clock_records(limit: int = 30):
    # Últimos registros da equipe inteira, para a visão administrativa
    items = clock_table.scan().get("Items", [])
    names = {e["id"]: e.get("name") for e in employees_table.scan().get("Items", [])}
    items.sort(key=lambda i: i["timestampUtc"], reverse=True)
    return [{**i, "employeeName": names.get(i["employeeId"])} for i in items[:limit]]


#@app.get("/clock/{employee_id}", response_model=List[ClockRecord])
#def list_clock_records(employee_id: str):
#    resp = clock_table.query(
#        KeyConditionExpression="employeeId = :eid",
#        ExpressionAttributeValues={":eid": employee_id},
#        Limit=20,  # últimos 20 registros, por exemplo
#        ScanIndexForward=False,  # ordenação decrescente (mais recente primeiro)
#   )
#    items = resp.get("Items", [])
    #return items


@app.get("/clock/{employee_id}", response_model=List[ClockRecord])
def list_clock_records(employee_id: str):
    resp = clock_table.query(
        KeyConditionExpression=Key("employeeId").eq(employee_id),
        Limit=50,
        ScanIndexForward=False,
    )
    return resp.get("Items", [])

@app.get("/health")
def health():
    # Public route: used by ALB/Route 53 health checks and by the frontend region indicator
    return {
        "status": "ok",
        "region": AWS_REGION,
        "regionName": REGION_NAMES.get(AWS_REGION, AWS_REGION),
        "availabilityZone": AVAILABILITY_ZONE,
    }


print("AWS_REGION =", os.getenv("AWS_REGION"))
print("AWS_DEFAULT_REGION =", os.getenv("AWS_DEFAULT_REGION"))
print("DYNAMODB_ENDPOINT =", os.getenv("DYNAMODB_ENDPOINT"))
print("boto3 region =", dynamodb.meta.client.meta.region_name)
print("boto3 endpoint =", dynamodb.meta.client.meta.endpoint_url)