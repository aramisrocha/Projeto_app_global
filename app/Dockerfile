FROM python:3.11-slim

# Evitar que o Python gere .pyc e use buffer de saída
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Instala dependências do sistema se precisar (opcional, aqui bem enxuto)
RUN pip install --upgrade pip

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Porta da aplicação
EXPOSE 8000

# Comando para iniciar a API
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
