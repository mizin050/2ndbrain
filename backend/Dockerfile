FROM python:3.11-slim

# System deps needed by pypdf/python-docx/bs4 etc. (kept minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better Docker layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the app
COPY . .

# HF Spaces routes traffic to port 7860 by default
ENV PORT=7860
ENV HOST=0.0.0.0
EXPOSE 7860

# Create a non-root user (HF Spaces recommends this)
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "7860"]