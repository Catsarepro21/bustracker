# Use official Python lightweight image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose port and start Gunicorn (2 threads to allow UI and background polo loop to run smoothly)
EXPOSE 5000
CMD ["gunicorn", "tracker:app", "--threads", "2", "-b", "0.0.0.0:5000"]
