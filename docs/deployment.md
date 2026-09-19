# Deployment

V1 is intended for trusted lab/internal networking.

## 1. Create a SELECT-only PostgreSQL role

Run as a database administrator and replace the password value through your
secret-management workflow:

    CREATE ROLE bioharness_web LOGIN PASSWORD '<secret>';
    GRANT CONNECT ON DATABASE bioharness TO bioharness_web;
    GRANT USAGE ON SCHEMA public TO bioharness_web;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO bioharness_web;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT ON TABLES TO bioharness_web;
    ALTER ROLE bioharness_web SET default_transaction_read_only = on;

Do not grant ownership, CREATE, INSERT, UPDATE, DELETE, TRUNCATE or REFERENCES.

For an already existing role, revoke accidental write capabilities before use:

    REVOKE CREATE ON SCHEMA public FROM bioharness_web;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON ALL TABLES IN SCHEMA public FROM bioharness_web;
    ALTER ROLE bioharness_web SET default_transaction_read_only = on;

Verify:

    SHOW default_transaction_read_only;
    SELECT count(*) FROM scientific_task_specs;

A write or DDL statement must fail.

## 2. Build

From the repository root:

    docker build -f deploy/Dockerfile -t bioharness-web:observatory-v1 .

## 3. Run

The service needs only a PostgreSQL URL and a network path to that database:

    docker run -d \
      --name bioharness-web-observatory \
      --restart unless-stopped \
      --network <bioharness-db-network> \
      -p 18080:8080 \
      -e BIOHARNESS_WEB_DATABASE_URL='postgresql+psycopg://bioharness_web:<secret>@<db-host>:5432/bioharness' \
      -e BIOHARNESS_WEB_POLL_INTERVAL_SECONDS=2 \
      bioharness-web:observatory-v1

The container does not require writable mounts to BioHarness source, Genome-web
scientific data, or provider outputs.

## 4. Smoke checks

    curl -fsS http://127.0.0.1:18080/api/health
    curl -fsS http://127.0.0.1:18080/api/tasks
    curl -N --max-time 5 http://127.0.0.1:18080/api/stream

Then open http://<host>:18080/ from an authorized lab network/tunnel.

## 5. Failure isolation

Stopping or deleting the Web container must not affect BioHarness execution.
If the database or SSE stream becomes temporarily unavailable, the frontend
keeps the last successful task graph visible and labels it stale.
