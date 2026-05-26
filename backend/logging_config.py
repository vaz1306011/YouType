import logging
from pathlib import Path

_PROJECT_ROOT = Path(__file__).parent.parent


class _RelativePathFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        try:
            record.pathname = str(Path(record.pathname).relative_to(_PROJECT_ROOT))
        except ValueError:
            pass
        return super().format(record)


def setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(
        _RelativePathFormatter(
            fmt="%(asctime)s [%(levelname)s] %(pathname)s:%(lineno)d\n  %(message)s\n",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    logging.basicConfig(level=logging.INFO, handlers=[handler])
