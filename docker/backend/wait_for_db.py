from __future__ import annotations

import os
import time

import psycopg2


def main() -> None:
    host = os.getenv("DB_HOST", "db")
    port = int(os.getenv("DB_PORT", "5432"))
    user = os.getenv("DB_USER", "postgres")
    password = os.getenv("DB_PASSWORD", "")
    dbname = os.getenv("DB_NAME", "novel_buds")

    timeout_s = int(os.getenv("DB_WAIT_SECONDS", "60"))
    deadline = time.time() + timeout_s

    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            conn = psycopg2.connect(
                host=host,
                port=port,
                user=user,
                password=password,
                dbname=dbname,
            )
            conn.close()
            print("Database is ready.")
            return
        except Exception as e:  # noqa: BLE001
            last_error = e
            print("Waiting for database...")
            time.sleep(2)

    raise RuntimeError(f"Database not ready after {timeout_s}s: {last_error}")


if __name__ == "__main__":
    main()
