FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py
COPY tv_sleep /app/tv_sleep
COPY templates /app/templates
COPY static /app/static

EXPOSE 8010

CMD ["python", "/app/app.py"]
