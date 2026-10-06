FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /srv
RUN pip install --no-cache-dir "fastapi>=0.115" "uvicorn[standard]>=0.30" "pydantic>=2"
COPY python/bbc_engine/src/bbc_engine /srv/bbc_engine
COPY services/engine-api/app.py /srv/app.py
RUN useradd -r app && chown -R app /srv
USER app
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
