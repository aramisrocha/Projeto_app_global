from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from datetime import datetime, timezone

import boto3
import os

# Nome das tabelas (pode vir de variável de ambiente no ECS)
EMPLOYEES_TABLE = os.getenv("EMPLOYEES_TABLE", "Employees")
CLOCK_TABLE = os.getenv("CLOCK_TABLE", "ClockRecords")

dynamodb = boto3.resource("dynamodb")
employees_table = dynamodb.Table(EMPLOYEES_TABLE)
clock_table = dynamodb.Table(CLOCK_TABLE)

app = FastAPI(title="Registro de Ponto - Global Lab")


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
    type: str  # "IN" ou "OUT"


class ClockRecord(BaseModel):
    employeeId: str
    timestampUtc: str
    type: str


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
    # DynamoDB não garante ordenação, mas pra lab não tem problema
    return items


# ==== ROTAS DE REGISTRO DE PONTO ====

@app.post("/clock", response_model=ClockRecord)
def register_clock(clock: ClockCreate):
    # Verifica se o funcionário existe
    emp_resp = employees_table.get_item(Key={"id": clock.employeeId})
    if "Item" not in emp_resp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Timestamp em UTC
    now_utc = datetime.now(timezone.utc).isoformat()

    if clock.type not in ("IN", "OUT"):
        raise HTTPException(status_code=400, detail="type must be 'IN' or 'OUT'")

    item = {
        "employeeId": clock.employeeId,
        "timestampUtc": now_utc,
        "type": clock.type,
    }

    clock_table.put_item(Item=item)
    return item


@app.get("/clock/{employee_id}", response_model=List[ClockRecord])
def list_clock_records(employee_id: str):
    resp = clock_table.query(
        KeyConditionExpression="employeeId = :eid",
        ExpressionAttributeValues={":eid": employee_id},
        Limit=20,  # últimos 20 registros, por exemplo
        ScanIndexForward=False,  # ordenação decrescente (mais recente primeiro)
    )
    items = resp.get("Items", [])
    return items
