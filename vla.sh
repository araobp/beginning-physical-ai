#!/bin/bash

# Function to clean up background jobs
cleanup() {
    echo "Terminating background jobs..."
    # Use pkill to find and kill the processes by their command line
    pkill -f "${PYTHON_CMD}.*mcp_server.py"
    pkill -f "sveltekit/mcp_client.*vite.*dev"
    echo "Cleanup complete."
}

# Trap Ctrl-C and other termination signals to clean up background jobs.
trap 'cleanup; exit' INT TERM

# Determine Python command based on OS
PYTHON_CMD="python"
if [[ "$(uname)" == "Darwin" ]]; then
    PYTHON_CMD="python3"
fi

# Check if the MCP server is running
if ! pgrep -f "${PYTHON_CMD}.*mcp_server.py" > /dev/null
then
    # If not running, start it in the background
    echo "MCP server is not running. Starting it in the background..."
    $PYTHON_CMD python/mcp_server/mcp_server.py &
    sleep 5 # Wait a moment for the server to initialize
fi

# Check if the SvelteKit client is running
if ! pgrep -f "sveltekit/mcp_client.*vite.*dev" > /dev/null
then
    # If not running, start it in the background
    echo "SvelteKit client is not running. Starting it in the background..."
    (cd sveltekit/mcp_client && npm run dev -- --open) &
    sleep 10 # Wait for the client to build and start
fi

if [[ "$(uname)" == "Darwin" ]]; then
    # On macOS, open a new Terminal window for the Gemini CLI.
    osascript -e "tell application \"Terminal\" to do script \"cd '$(pwd)' && gemini --model gemini-2.5-flash\""
    echo "Servers are running in the background."
    echo "Press Ctrl-C in this window to stop them."
else
    # On other OSes, run in the current window as a generic solution is difficult.
    gemini --model gemini-2.5-flash
fi

# Wait for all background jobs to finish.
# This allows the trap to work when Ctrl-C is pressed.
wait
