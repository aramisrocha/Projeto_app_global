terraform {
  required_version = ">= 1.3.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# ===========================
# Tabelas DynamoDB do app de ponto
# ===========================

resource "aws_dynamodb_table" "employees" {
  name         = var.employees_table_name
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "id"

  attribute {
    name = "id"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name        = var.employees_table_name
    Environment = var.environment
    App         = "ponto-global"
  }
}

resource "aws_dynamodb_table" "clock_records" {
  name         = var.clock_table_name
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "employeeId"
  range_key = "timestampUtc"

  attribute {
    name = "employeeId"
    type = "S"
  }

  attribute {
    name = "timestampUtc"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name        = var.clock_table_name
    Environment = var.environment
    App         = "ponto-global"
  }
}

# ===========================
# Variáveis
# ===========================

variable "region" {
  description = "Região AWS"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Ambiente (dev, lab, prod)"
  type        = string
  default     = "lab"
}

variable "employees_table_name" {
  description = "Nome da tabela de funcionários"
  type        = string
  default     = "Employees"
}

variable "clock_table_name" {
  description = "Nome da tabela de registros de ponto"
  type        = string
  default     = "ClockRecords"
}

# ===========================
# Outputs (pra usar depois no ECS/IAM)
# ===========================

output "employees_table_name" {
  value       = aws_dynamodb_table.employees.name
  description = "Nome da tabela Employees"
}

output "clock_table_name" {
  value       = aws_dynamodb_table.clock_records.name
  description = "Nome da tabela ClockRecords"
}

output "employees_table_arn" {
  value       = aws_dynamodb_table.employees.arn
  description = "ARN da tabela Employees"
}

output "clock_table_arn" {
  value       = aws_dynamodb_table.clock_records.arn
  description = "ARN da tabela ClockRecords"
}
