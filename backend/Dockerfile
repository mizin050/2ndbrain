FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed for compilation (e.g. for numpy/chromadb)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY . .

# Set environment variables
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/data/chroma_db

# Expose port
EXPOSE 8080

# Command to run application
CMD ["python", "ai-layer/api.py"]
