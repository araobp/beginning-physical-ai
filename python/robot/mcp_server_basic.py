from fastmcp import FastMCP
import serial
import time

# Initialize FastMCP server
mcp = FastMCP("RobotArmController")

# Serial configuration
# NOTE: Update SERIAL_PORT to match your connected Arduino
# Linux: /dev/ttyUSB0 or /dev/ttyACM0
# Mac: /dev/cu.usbmodemXXXX or /dev/tty.usbserialXXXX
# Windows: COM3, COM4, etc.
#SERIAL_PORT = '/dev/ttyUSB0'
SERIAL_PORT = '/dev/cu.usbmodem101'  # Mac
BAUD_RATE = 9600
TIMEOUT = 10  # Seconds to wait for robot response

_serial_conn = None

def get_serial():
    """Get or create the serial connection lazily."""
    global _serial_conn
    if _serial_conn and _serial_conn.is_open:
        return _serial_conn
    
    try:
        _serial_conn = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=TIMEOUT)
        # Wait for Arduino to reset after connection
        time.sleep(2)
        # Clear any startup messages
        _serial_conn.reset_input_buffer()
        return _serial_conn
    except serial.SerialException as e:
        print(f"Error opening serial port {SERIAL_PORT}: {e}")
        return None

def send_command(cmd: str) -> str:
    """
    Send a command to the Arduino and wait for the '%' delimiter.
    The Arduino controller prints '%' after finishing command execution.
    """
    conn = get_serial()
    if not conn:
        return "Error: Serial connection not available. Check USB connection and port."

    try:
        # Send command with newline
        full_cmd = cmd.strip() + "\n"
        conn.write(full_cmd.encode('utf-8'))

        response = []
        while True:
            # Read line by line
            line = conn.readline().decode('utf-8', errors='replace').strip()
            
            # Check for timeout (empty line returned by readline)
            if not line and conn.in_waiting == 0:
                # If we haven't received the delimiter yet, it might be a timeout
                # or just a slow move. But readline() returns '' on timeout.
                if not response:
                    return "Error: Command timed out."
                break
                
            # The controller signals completion with '%'
            if line == '%':
                break
                
            if line:
                response.append(line)
                
        return "\n".join(response) if response else "Success"
    except Exception as e:
        return f"Communication Error: {e}"

@mcp.tool()
def move_to(x: float, y: float, z: float, speed: float = 50.0) -> str:
    """
    Moves the robot arm to the specified coordinates (mm).
    
    Args:
        x: Target X coordinate (mm)
        y: Target Y coordinate (mm)
        z: Target Z coordinate (mm)
        speed: Movement speed (default 50.0)
    """
    return send_command(f"move x={x} y={y} z={z} s={speed}")

@mcp.tool()
def grip(state: str) -> str:
    """
    Controls the gripper.
    
    Args:
        state: 'open' or 'close'
    """
    if state not in ('open', 'close'):
        return "Error: State must be 'open' or 'close'"
    return send_command(f"grip {state}")

@mcp.tool()
def calibrate_gripper(state: str) -> str:
    """
    Registers the current gripper position as the open or close limit.
    
    Args:
        state: 'open' or 'close'
    """
    if state not in ('open', 'close'):
        return "Error: State must be 'open' or 'close'"
    return send_command(f"calibg {state}")

@mcp.tool()
def calibrate_joint(point_index: int, x: float, y: float, z: float) -> str:
    """
    Calibrates Inverse Kinematics reference points.
    
    Args:
        point_index: 0 or 1 (Reference point index)
        x: X coordinate for this point
        y: Y coordinate for this point
        z: Z coordinate for this point
    """
    return send_command(f"calib{point_index} x={x} y={y} z={z}")

@mcp.tool()
def save_config() -> str:
    """Saves the current calibration and configuration to EEPROM."""
    return send_command("save")

@mcp.tool()
def get_status() -> str:
    """Returns the current configuration and status dump."""
    return send_command("dump")

if __name__ == "__main__":
    # Run the MCP server
    mcp.run(transport="streamable-http", host="0.0.0.0", port=8888)