FROM python:3.13-slim

WORKDIR /app

# Install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ backend/

# Run uvicorn on plain HTTP (nginx handles SSL)
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
