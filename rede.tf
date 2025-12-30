terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}


# Criando a VPC na regiao de virginia

module "network_primary" {
  source = "../Modules/networking"


  providers = {
    aws = aws.primary
  }

  name                 = "Projeto_api_global-primario"
  vpc_cidr             = "10.0.0.0/16"
  enable_dns_hostnames = true

  subnets = [
    {
      name = "SubnetA"
      cidr = "10.0.1.0/24"
      az   = "${var.primary_region}a"  # ex: us-east-1a
    }
  ]
}

# Criando uma VPC na regiao 

module "network_secondary" {
  source = "../Modules/networking"

  providers = {
    aws = aws.secondary
  }

  name                 = "Projeto_api_global-secondario"
  vpc_cidr             = "10.1.0.0/16"
  enable_dns_hostnames = true

  subnets = [
    {
      name = "SubnetA"
      cidr = "10.1.1.0/24"
      az   = "${var.secondary_region}a"  # ex: sa-east-1a
    }
  ]
}


