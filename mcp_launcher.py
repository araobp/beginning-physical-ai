import curses
import subprocess
import threading
import time
import psutil
import os
import sys
import tempfile
import re
from collections import deque

# --- Configuration ---
PYTHON_CMD = "python3" if sys.platform == "darwin" else "python"
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
MCP_SERVER_LANG = "ja" # Default language, will be set by user prompt
MCP_CLIENT_THEME = "default" # Default theme

PROCESSES = [
    {
        "name": "MCP Server",
        "cmd": [PYTHON_CMD, os.path.join(PROJECT_ROOT, "python/mcp_server/mcp_server.py"), "--quiet"],
        "cwd": PROJECT_ROOT,
        "search_term": "mcp_server.py",
        "pid": None,
        "process": None,
        "status": "Stopped",
        "log": deque(maxlen=100),
    },
    {
        "name": "MCP Client",
        "cmd": ["npm", "run", "dev", "--", "--open"],
        "cwd": os.path.join(PROJECT_ROOT, "sveltekit/mcp_client"),
        "search_term": "sveltekit/mcp_client.*vite",
        "pid": None,
        "process": None,
        "status": "Stopped",
        "log": deque(maxlen=100),
    },
]

# --- Gemini CLI Log State ---
gemini_output_buffer = deque(maxlen=1000)
gemini_output_buffer.append("--- Press 'g' to start an interactive Gemini CLI session ---")

def strip_ansi(text):
    """Strip ANSI escape codes for cleaner display in curses."""
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)


# --- Process Management ---

def read_output(process, log_deque):
    """Read stdout from a process and append to a deque."""
    try:
        for line in iter(process.stdout.readline, ''):
            log_deque.append(line.strip())
        process.stdout.close()
    except Exception:
        pass # Ignore errors on closed streams

def check_statuses():
    """Update the status of all managed processes using psutil."""
    pids_running = {p.pid for p in psutil.process_iter(['pid'])}
    for proc_info in PROCESSES:
        # First, check if our managed process object is still alive
        # 管理しているプロセスオブジェクトがまだ生きているか確認
        if proc_info["process"]:
            poll_ret = proc_info["process"].poll()
            if poll_ret is None:
                proc_info["status"] = "Running"
                proc_info["pid"] = proc_info["process"].pid
                continue
            else:
                # Process exited
                if proc_info["status"] == "Running":
                    proc_info["log"].append(f"Process exited with code {poll_ret}")
                proc_info["process"] = None # Clear handle

        # If not, search for a matching process by command line
        # プロセスハンドルがない場合、コマンドライン引数で一致するプロセスを探す（再起動時など）
        found = False
        for p in psutil.process_iter(['pid', 'cmdline']):
            try:
                cmdline = " ".join(p.info['cmdline']) if p.info['cmdline'] else ""
                if proc_info["search_term"] in cmdline:
                    proc_info["pid"] = p.info['pid']
                    proc_info["status"] = "Running"
                    found = True
                    break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        if not found:
            proc_info["pid"] = None
            proc_info["process"] = None
            proc_info["status"] = "Stopped"

def start_process(proc_info):
    """Start a process if it's not already running."""
    if proc_info["status"] == "Running":
        return
    try:
        proc_info["log"].clear()
        proc_info["log"].append(f"Starting {proc_info['name']}...")

        cmd_to_run = list(proc_info["cmd"]) # Make a copy to modify
        env = os.environ.copy()

        if proc_info["name"] == "MCP Server":
            cmd_to_run.extend(["--lang", MCP_SERVER_LANG])
            proc_info["log"].append(f"Starting with language: {MCP_SERVER_LANG}")
        elif proc_info["name"] == "MCP Client":
            env["PUBLIC_MCP_LANGUAGE"] = MCP_SERVER_LANG
            env["PUBLIC_MCP_THEME"] = MCP_CLIENT_THEME

        # Use preexec_fn=os.setsid to create a new process group
        # 新しいプロセスグループを作成して、シグナル送信時に子プロセスもまとめて終了できるようにする
        proc_info["process"] = subprocess.Popen(
            cmd_to_run,
            cwd=proc_info["cwd"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=env,
            text=True,
            encoding='utf-8',
            errors='replace',
            preexec_fn=os.setsid if sys.platform != "win32" else None
        )
        # Start a thread to read the process output
        thread = threading.Thread(target=read_output, args=(proc_info["process"], proc_info["log"]), daemon=True)
        thread.start()
        proc_info["status"] = "Running"
        proc_info["pid"] = proc_info["process"].pid
        proc_info["log"].append(f"Started with PID: {proc_info['pid']}")
    except Exception as e:
        proc_info["status"] = "Error"
        proc_info["log"].append(f"Error starting: {e}")

def stop_process(proc_info):
    """Stop a process."""
    if proc_info["status"] != "Running" or not proc_info["pid"]:
        return
    proc_info["log"].append(f"Stopping {proc_info['name']} (PID: {proc_info['pid']})...")
    try:
        # Kill the entire process group
        # プロセスグループ全体にSIGTERMを送信
        if sys.platform != "win32":
            os.killpg(os.getpgid(proc_info["pid"]), 15) # SIGTERM
        else:
            # On Windows, os.killpg is not available, terminate the main process
            psutil.Process(proc_info["pid"]).terminate()

        # Wait a bit for graceful shutdown
        # 少し待ってから、まだ残っていれば強制終了 (SIGKILL)
        time.sleep(1)
        if psutil.pid_exists(proc_info["pid"]):
             if sys.platform != "win32":
                os.killpg(os.getpgid(proc_info["pid"]), 9) # SIGKILL
             else:
                psutil.Process(proc_info["pid"]).kill()

        proc_info["log"].append("Process stopped.")
    except (ProcessLookupError, psutil.NoSuchProcess):
        proc_info["log"].append("Process already stopped.")
    except Exception as e:
        proc_info["log"].append(f"Error stopping: {e}")
    finally:
        proc_info["pid"] = None
        proc_info["process"] = None
        proc_info["status"] = "Stopped"

def stop_all_processes():
    """Stop all managed processes."""
    for proc_info in PROCESSES:
        if proc_info["status"] == "Running":
            stop_process(proc_info)

# --- Curses TUI ---

def draw_main_window(stdscr, selected_row):
    """Draw the main TUI window with status list and logs."""
    stdscr.clear()
    h, w = stdscr.getmaxyx()

    # Title and Help
    title = "MCP Server Launcher"
    stdscr.addstr(0, (w - len(title)) // 2, title, curses.A_BOLD)
    help_text = "[↑↓]Select [s]Start [k]Stop [r]Restart [g]Gemini CLI [q]Quit"
    stdscr.addstr(1, 0, help_text.ljust(w-1), curses.A_REVERSE)

    # Status Window
    status_win_h = len(PROCESSES) + 2
    status_win = stdscr.subwin(status_win_h, w, 3, 0)
    status_win.box()
    status_win.addstr(0, 2, " Services ")

    for i, proc in enumerate(PROCESSES):
        status_str = f"{proc['name']:<20} {proc['status']:<10} PID: {proc['pid'] or 'N/A'}"
        style = curses.A_NORMAL
        if proc['status'] == "Running":
            style |= curses.color_pair(1) # Green
        elif proc['status'] == "Stopped":
            style |= curses.color_pair(2) # Red
        if i == selected_row:
            style |= curses.A_REVERSE
        status_win.addstr(i + 1, 2, status_str, style)

    # Log Window (Bottom Half)
    log_win_y = 3 + status_win_h
    available_h = h - log_win_y - 1
    
    if available_h > 4:
        log_win = stdscr.subwin(available_h, w, log_win_y, 0)
        log_win.box()
        
        selected_proc = PROCESSES[selected_row]
        title = f" Log: {selected_proc['name']} "
        log_win.addstr(0, 2, title[:w-3])
        
        # Draw buffer
        log_data = list(selected_proc["log"])
        max_lines = available_h - 2
        start_line = max(0, len(log_data) - max_lines)
        for i, line in enumerate(log_data[start_line:]):
            if i < max_lines:
                log_win.addstr(i + 1, 2, line[:w-4])
        
        log_win.refresh()

    stdscr.refresh()
    status_win.refresh()

def main_tui(stdscr):
    """Main event loop for the Curses TUI."""
    curses.curs_set(0)
    stdscr.nodelay(1)
    curses.start_color()
    curses.init_pair(1, curses.COLOR_GREEN, curses.COLOR_BLACK)
    curses.init_pair(2, curses.COLOR_RED, curses.COLOR_BLACK)

    selected_row = 0
    last_check_time = 0
    
    # Auto-start all processes
    # 起動時にすべてのプロセスを自動開始
    for proc in PROCESSES:
        start_process(proc)
        # Add a small delay after starting the server to give it time to initialize
        if proc["name"] == "MCP Server":
            time.sleep(3)

    while True:
        # 定期的にプロセスのステータスを更新
        if time.time() - last_check_time > 1:
            check_statuses()
            last_check_time = time.time()

        draw_main_window(stdscr, selected_row)

        try:
            key = stdscr.getch()
        except curses.error:
            key = -1

        if key == curses.KEY_UP:
            selected_row = max(0, selected_row - 1)
        elif key == curses.KEY_DOWN:
            selected_row = min(len(PROCESSES) - 1, selected_row + 1)
        elif key == ord('q'):
            break
        elif key == ord('s'):
            start_process(PROCESSES[selected_row])
        elif key == ord('k'):
            stop_process(PROCESSES[selected_row])
        elif key == ord('r'):
            stop_process(PROCESSES[selected_row])
            time.sleep(0.5)
            start_process(PROCESSES[selected_row])
        elif key == ord('g'):
            # --- Suspend curses and run interactive Gemini CLI ---
            # Cursesモードを一時停止し、Gemini CLIをインタラクティブモードで実行
            
            # Check for GEMINI_API_KEY
            log_filename = ""
            try:
                with tempfile.NamedTemporaryFile(mode='w', delete=False) as log_file:
                    log_filename = log_file.name
            except Exception as e:
                 # Handle case where tempfile creation fails
                 curses.flash() # Visual bell
                 continue

            curses.def_prog_mode()
            curses.endwin()

            if "GEMINI_API_KEY" not in os.environ:
                print("\n\033[91mERROR: The GEMINI_API_KEY environment variable is not set.\033[0m")
                print("Please set it before running the launcher. e.g., 'export GEMINI_API_KEY=...'")
                input("Press Enter to return...")
                curses.reset_prog_mode()
                stdscr.refresh()
                continue

            if sys.platform == "win32":
                print("--- Launching Gemini CLI (interactive mode not supported on Windows) ---")
                subprocess.run(["gemini", "--model", "gemini-2.5-flash"])
            else:
                print("--- Launching Interactive Gemini CLI ---")
                print("--- Session will be recorded. Type 'exit' or press Ctrl+D to return. ---")
                try:
                    subprocess.run(["script", "-q", log_filename, "gemini", "--model", "gemini-2.5-flash"])
                except FileNotFoundError:
                    print("\nERROR: `script` command not found. Cannot record session.")
                    print("Running Gemini CLI without recording...")
                    subprocess.run(["gemini", "--model", "gemini-2.5-flash"])
                except Exception as e:
                    print(f"\nAn error occurred: {e}")
                    input("Press Enter to return...")

            # Read back the log
            # 記録されたログを読み込んでバッファに表示
            gemini_output_buffer.clear()
            gemini_output_buffer.append("--- Log of last Gemini CLI session ---")
            if os.path.exists(log_filename) and os.path.getsize(log_filename) > 0:
                with open(log_filename, 'r', errors='replace') as f:
                    for line in f:
                        gemini_output_buffer.append(strip_ansi(line.rstrip()))
            else:
                gemini_output_buffer.append("(No session log was recorded)")
            os.remove(log_filename)

            curses.reset_prog_mode()
            stdscr.refresh()

        time.sleep(0.1)

if __name__ == "__main__":
    try:
        import psutil
    except ImportError:
        print("Error: 'psutil' library is required.")
        print("Please install it using: pip install psutil")
        sys.exit(1)

    # --- Language & Theme Selection ---
    print("起動設定を選択してください。 (Please select configuration.)")
    print("  1) 日本語 (Japanese) - Default Theme")
    print("  2) 日本語 (Japanese) - Spaceship Theme")
    print("  3) 英語 (English) - Default Theme")
    print("  4) 英語 (English) - Spaceship Theme")
    print("")
    choice = input("番号を入力してください (Enter number) [1]: ").strip()
    
    if choice == "2":
        MCP_CLIENT_THEME = "spaceship"
    elif choice == "3":
        MCP_SERVER_LANG = "en"
    elif choice == "4":
        MCP_SERVER_LANG = "en"
        MCP_CLIENT_THEME = "spaceship"

    try:
        curses.wrapper(main_tui)
    except curses.error as e:
        print("Curses error. Your terminal might not support it.", e)
    finally:
        print("Shutting down all background processes...")
        stop_all_processes()
        print("Done.")