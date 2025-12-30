########################################
# Security Group para Lambda - Região Primária
########################################

resource "aws_security_group" "lambda_primary_sg" {
  provider = aws.primary

  name        = "lambda_primary_sg"
  description = "Security Group para funcoes Lambda na regiao primaria"
  vpc_id      = module.network_primary.vpc_id

  # Lambda normalmente nao precisa de regras de entrada,
  # pois ela inicia conexoes para outros recursos (RDS, API, etc.)
  # Se precisar de entrada (por exemplo, de um NLB), adicionamos depois.

  # Saída liberada para qualquer destino (padrao para Lambda em VPC)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "lambda_primary_sg"
    Project     = "Projeto_api_global"
    Environment = "dev"
  }
}

########################################
# Security Group para Lambda - Região Secundária
########################################

resource "aws_security_group" "lambda_secondary_sg" {
  provider = aws.secondary

  name        = "lambda_secondary_sg"
  description = "Security Group para funcoes Lambda na regiao secundaria"
  vpc_id      = module.network_secondary.vpc_id

  # Sem regras de entrada por enquanto (mesmo raciocinio da primaria)

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name        = "lambda_secondary_sg"
    Project     = "Projeto_api_global"
    Environment = "dev"
  }
}
