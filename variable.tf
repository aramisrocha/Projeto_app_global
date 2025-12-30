variable "primary_region" {
  default = "us-east-1"
}

variable "secondary_region" {
  default = "eu-west-1"
}

provider "aws" {
  region = var.primary_region
  alias  = "primary"
}

provider "aws" {
  region = var.secondary_region
  alias  = "secondary"
}