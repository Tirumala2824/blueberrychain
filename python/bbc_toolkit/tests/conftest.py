import sys
from pathlib import Path

# Test helpers (fake_snowflake.py) live next to the tests; importlib import mode needs this.
sys.path.insert(0, str(Path(__file__).parent))
