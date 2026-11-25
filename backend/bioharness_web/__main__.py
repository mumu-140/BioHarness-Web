"""python -m bioharness_web: serve on the configured host (loopback by default)."""
import logging

import uvicorn

from .app import create_app
from .settings import Settings


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
