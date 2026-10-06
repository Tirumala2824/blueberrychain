"""Deterministic decision evaluation engine for BlueberryChain OS.

Every number a decision relies on is produced here - never by an LLM.
The same package runs locally (tests, simulator) and inside Snowflake
Python procedures, so it must stay compatible with the Snowpark runtime.
"""

__version__ = "0.1.0"
