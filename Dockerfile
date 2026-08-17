FROM python:3.11-alpine

WORKDIR /app

# Copy application source code
COPY . /app

# Default environment configuration
ENV PORT=8080
ENV IMMICH_URL=http://localhost:2283

EXPOSE 8080

CMD ["python3", "server.py"]
