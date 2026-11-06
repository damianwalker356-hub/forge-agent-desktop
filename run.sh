#!/bin/sh
# Start the agent under the supervisor. Usage: FORGE_MODEL=llama3.1:8b ./run.sh
cd "$(dirname "$0")"
exec python3 supervisor.py
