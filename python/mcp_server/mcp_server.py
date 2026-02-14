"""
ロボットアームおよびビジョンシステムを統合制御するMCP (Model-Centric Protocol) サーバーです。

このサーバーは以下の機能を提供します:
- FastMCPフレームワークを介したAIエージェントとのツールベースの対話
- Arduinoベースのロボットアームとのシリアル通信
- OpenCVベースのビジョンシステム（ArUcoマーカーによる姿勢推定と座標変換）
"""
from fastmcp import FastMCP
import serial
import serial.tools.list_ports
import time
import sys
import csv
import json
import base64
import cv2
import re
import queue
import argparse
import threading
import http.server
import socketserver
import os
from vision_system import VisionSystem
try:
    from ultralytics import YOLO
except ImportError:
    print("Warning: 'ultralytics' module not found. Object detection disabled.")
    YOLO = None
try:
    from joypad import get_joypad_system
except ImportError:
    print("Warning: 'joypad' module not found or 'hid' library missing. Joypad support disabled.")
    get_joypad_system = None
try:
    from calibration_gui import CalibrationGUI
except ImportError:
    print("Warning: 'calibration_gui' module not found.")
    CalibrationGUI = None

# --- 言語設定 (引数解析前に簡易チェック) ---
LANG = 'ja'
if '--lang' in sys.argv:
    try:
        idx = sys.argv.index('--lang')
        if idx + 1 < len(sys.argv):
            LANG = sys.argv[idx + 1]
    except:
        pass

# --- 基本設定 ---
# ロボットアーム（Arduino）が接続されているシリアルポート
def detect_serial_port():
    """
    USBシリアルポートを自動検出し、番号が最小のものを返します。
    """
    ports = [p.device for p in serial.tools.list_ports.comports()]
    # USBシリアルらしいデバイスをフィルタリング (Mac/Linux/Windows)
    # Mac: cu.usbmodem..., Linux: ttyACM.../ttyUSB..., Windows: COM...
    usb_ports = [p for p in ports if any(k in p for k in ['usbmodem', 'ttyACM', 'ttyUSB', 'COM'])]
    
    if not usb_ports:
        fallback_port = '/dev/cu.usbmodem101'
        print(f"Warning: No USB serial ports detected. Using default fallback: {fallback_port}")
        return fallback_port
    
    # 自然順ソート (例: COM3 < COM10)
    def natural_keys(text):
        return [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', text)]
    
    usb_ports.sort(key=natural_keys)
    print(f"Auto-detected serial port: {usb_ports[0]} (from {usb_ports})")
    return usb_ports[0]

SERIAL_PORT = detect_serial_port()
# シリアル通信のボーレート
BAUD_RATE = 9600
# コマンド応答のタイムアウト（秒）
TIMEOUT = 45
# 送信コマンドをコンソールに出力するかどうか
VERBOSE_SERIAL = True

# --- ビジョンシステム設定 ---
# カメラキャリブレーションによって得られた内部パラメータファイル
CAMERA_PARAMS_PATH = '../vision/chessboard/calibration_data.npz'
# 座標系の原点として使用するArUcoマーカーのID
ARUCO_MARKER_ID = 14
# ArUcoマーカーの物理的な一辺の長さ (mm)
ARUCO_MARKER_SIZE_MM = 63.0
# 使用するカメラのデバイスID
CAMERA_ID = 0

# ロボットベースのオフセット設定 (mm)
# マーカー座標系(ArUco原点)からロボットベース座標系への変換
# カッティングマットの150mmの位置へロボットのベース前方を密着させた場合の調整値
# マーカー座標系の原点(x=0, y=0)は、世界座標系では X=196mm, Y=100mm となるため、オフセットは正の値(mm)となります。
ROBOT_BASE_OFFSET_X = 140.0 + 56.0
ROBOT_BASE_OFFSET_Y = 100.0
YOLO_MODEL_PATH = "best.pt"

mcp = FastMCP(
    "RobotArmController"
)

# --- グローバルリソース ---
# VisionSystemとシリアル接続は、必要になるまで初期化しない（遅延初期化）
_vision_system = None
_serial_conn = None
_yolo_model = None
_serial_lock = threading.Lock() # シリアル通信の排他制御用ロック

# GUI起動リクエスト用のキュー (macOSでのOpenCVスレッド制約対策)
gui_queue = queue.Queue()

# --- 内部ヘルパー関数 ---
def _fetch_workpiece_data():
    """作業対象物（ワーク）の定義情報を返す"""
    workpieces = {}
    csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workpieces.csv")
    
    try:
        with open(csv_path, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                class_label = row['class_label']
                # CSVのカラム名に合わせてデータを取得し、欠損値にはデフォルトを設定
                height_val = float(row.get('gripping_height', 0))

                if LANG == 'en':
                    workpieces[class_label] = {
                        "name": row['name_en'],
                        "gripping_height": height_val,
                        "description": row['description_en']
                    }
                else:
                    workpieces[class_label] = {
                        "name": row['name_ja'],
                        "gripping_height": height_val,
                        "description": row['description_ja']
                    }
    except FileNotFoundError:
        print(f"Warning: {csv_path} not found. Returning empty catalog.")
    except Exception as e:
        print(f"Error reading {csv_path}: {e}")
        
    return workpieces

def get_vision_system():
    """
    VisionSystemのシングルトンインスタンスを取得します（遅延初期化）。
    初回呼び出し時にカメラを初期化するため、不要なリソース確保を防ぎます。
    """
    global _vision_system
    if _vision_system is None:
        try:
            _vision_system = VisionSystem(
                camera_params_path=CAMERA_PARAMS_PATH,
                marker_id=ARUCO_MARKER_ID,
                marker_size_mm=ARUCO_MARKER_SIZE_MM,
                cam_id=CAMERA_ID,
                robot_offset_x_mm=ROBOT_BASE_OFFSET_X,
                robot_offset_y_mm=ROBOT_BASE_OFFSET_Y,
                lang=LANG
            )
            print("Vision system initialized successfully.")
        except Exception as e:
            print(f"Failed to initialize VisionSystem: {e}")
            return None
    return _vision_system

def get_yolo_model():
    """YOLOモデルのシングルトンインスタンスを取得します（遅延初期化）。"""
    global _yolo_model
    if _yolo_model is None and YOLO is not None:
        try:
            print(f"Loading YOLO model from {YOLO_MODEL_PATH}...")
            _yolo_model = YOLO(YOLO_MODEL_PATH)
            print("YOLO model loaded successfully.")
        except Exception as e:
            print(f"Failed to load YOLO model: {e}")
            return None
    return _yolo_model

def get_serial():
    """
    シリアルポート接続のシングルトンインスタンスを取得します（遅延初期化）。
    Arduinoとの接続を確立し、リセット後の安定待機を行います。
    """
    global _serial_conn
    if _serial_conn and _serial_conn.is_open:
        return _serial_conn
    try:
        _serial_conn = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=TIMEOUT)
        # Arduinoはシリアル接続時にリセットがかかるため、起動シーケンスが完了するのを待つ
        time.sleep(2)
        _serial_conn.reset_input_buffer()
        return _serial_conn
    except Exception as e:
        return None

def send_command(cmd: str) -> str:
    """
    コマンドをArduinoに送信し、応答を待機する。
    
    通信プロトコル：
    1. コマンド文字列の末尾に改行コード `\\n` を付与して送信。
    2. Arduinoからの応答を一行ずつ読み込む。
    3. 応答の最後にプロンプト文字 '%' が送られてきたら、コマンド完了とみなす。
    """
    if VERBOSE_SERIAL:
        print(f"[Serial] -> {cmd}")

    with _serial_lock:
        conn = get_serial()
        if not conn: return "Error: Cannot connect to robot." if LANG == 'en' else "Error: ロボットに接続できません。"
        try:
            full_cmd = cmd.strip() + "\n"
            conn.write(full_cmd.encode('utf-8'))
            response = []
            while True:
                line = conn.readline().decode('utf-8', errors='replace').strip()
                # コマンド完了の合図
                if line == '%': break
                # タイムアウト（readlineが空文字を返す）かつバッファが空の場合、ループを抜ける
                if not line and conn.in_waiting == 0: break
                if line: response.append(line)
            return "\n".join(response) if response else "Success"
        except Exception as e:
            return f"Error: {e}"

# =================================================================
# MCPツール群 (AIエージェントが利用するAPI)
# docstring（ここの説明文）が、AIの思考と行動の源泉となります。
# =================================================================

def set_doc(docstring):
    def decorator(func):
        func.__doc__ = docstring
        return func
    return decorator

TOOL_DOCS = {
    'en': {
        'get_workpiece_catalog': """
    Retrieves the catalog (physical properties list) of all workpieces registered in the system.
    Returns a JSON string.

    [Instructions for AI]
    When planning to manipulate objects (e.g., pick and place), **always execute this tool first** to understand the exact "gripping_height" to avoid collisions.

    [Data Structure Details]
    - name: Name of the workpiece.
    - gripping_height: Gripping height of the workpiece (mm). This is the Z coordinate to which the arm should descend to grip the object. If this value is 0, the object is not intended for gripping.
    - description: Supplementary information.

    [Important: Formula for Safe Path Planning]
    When moving horizontally with a workpiece, always raise the arm to the "Safety Height" calculated as:
    Safety Height (Z) = gripping_height + 50.0 (Safety Margin)
    """,
        'execute_sequence': """
    Sends a sequence of operations (command sequence) separated by semicolons ';' to the robot arm.

    [Command Syntax]
    1. move x=<val> y=<val> z=<val> s=<speed>:
       Moves the Tool Center Point (TCP) to the specified 3D coordinates (mm) in the **World Coordinate System (Robot Base)**.
       s is the speed, range 0-100.
    2. grip <open|close>:
       Opens or closes the gripper.
    3. delay t=<ms>:
       Pauses for the specified time (milliseconds). Use to wait for physical stability.

    [Rules for AI Controller]
    - **Insert Delays**: Always insert 'delay t=1000' after 'grip close' or 'grip open'.
    - **Use Safety Height**: Before horizontal movement, calculate safety height using `get_workpiece_catalog`.
    - **Collision Avoidance**: Always raise to safety height before moving horizontally after gripping.
    """,
        'get_robot_status': """
    Retrieves the current status of the robot arm.
    Returns a string containing TCP coordinates in **World Coordinate System (mm)**, joint angles, and other status info.
    Use this to understand the arm's current position before planning movements.
    """,
        'get_joypad_state': """
    Retrieves the current input state of the joypad.
    Returns JSON: {'X': float, 'Y': float, 'RX': float, 'RY': float}
    Values are typically between -1.0 and 1.0.
    """,
        'get_live_image': """
    Captures a live frame and/or detects objects. Returns JSON `{'image_jpeg_base64': '...', 'detections': [...]}`.

    [Coordinate Systems & Parameters]
    - **x, y, z**: Coordinates in World Coordinate System (Robot Base, mm).
    - **r**: Estimated radius of the object (mm).
    - **h**: Estimated height of the object (mm).
    - **u, v**: Pixel Coordinates on the image (px).
    - **u_norm, v_norm**: Normalized image coordinates (0-1000).
    - **u_top_norm, v_top_norm**: Normalized image coordinates of the object's top center (0-1000).
    - **radius_u_norm, radius_v_norm**: Normalized radius on the image.

    If `detect_objects` is true, `detections` includes `ground_center` containing these values for the object's base center.

    Args:
        visualize_axes (bool): If True, draws coordinate axes on the image.
        detect_objects (bool): If True, runs object detection.
        confidence (float): Confidence threshold for detection (default 0.7).
        return_image (bool): If True, returns the Base64 encoded image. If False, returns only detection results.
    """,
        'convert_coordinates': """
    Converts coordinates between World, ArUco Marker, and Pixel coordinate systems.

    [Coordinate Systems]
    - 'world': World Coordinate System (Robot Base, mm).
    - 'marker': ArUco Marker Coordinate System (mm).
    - 'pixel': Pixel Coordinates (u, v).

    Args:
        x (float): X coordinate (or u for pixel).
        y (float): Y coordinate (or v for pixel).
        z (float): Z coordinate (default 0.0). Ignored if source is 'pixel' (assumes Z=0 on marker plane).
        source (str): Source coordinate system ('world', 'marker', 'pixel').
        target (str): Target coordinate system ('world', 'marker', 'pixel').
    """,
    },
    'ja': {
        'get_workpiece_catalog': """
    システムに登録されている全てのワーク（作業対象物）のカタログ（物理特性リスト）を取得します。
    JSON形式の文字列で返されます。

    【AIへの指示】
    ロボットアームで物体を操作する計画（ピック＆プレイスなど）を立てる際には、対象物の正確な「把持高さ(gripping_height)」を把握するため、**必ず最初にこのツールを実行してください。**

    【データ構造の詳細】
    - name: ワークの名称（日本語）
    - gripping_height: ワークを把持する際のZ座標 (mm)。アームを下降させる際の目標高さとなります。この値が0の場合は、把持対象ではないことを意味します。
    - description: ワークに関する補足情報。
    """,
        'execute_sequence': """
    ロボットアームに一連の動作（コマンドシーケンス）をセミコロン ';' 区切りで送信します。

    【コマンド文法】
    1. move x=<値> y=<値> z=<値> s=<速度>:
       アームの先端 (TCP: Tool Center Point) を指定の3次元座標 (mm) へ移動させます。
       **座標系は「世界座標系（ロボットベース原点, mm）」です。**
       sは移動速度で、0から100の範囲で指定します。
    2. grip <open|close>:
       グリッパーを開きます ('open') または閉じます ('close')。
    3. delay t=<ミリ秒>:
       指定した時間 (ミリ秒単位) だけ動作を停止します。物理的な動作が安定するのを待つために使用します。

    【AI管制官への絶対遵守ルール：経路計画】
    - **待機時間の挿入**: 把持 (grip close) や解放 (grip open) の直後には、グリッパーが完全に動作するのを待つため、**必ず 'delay t=1000' (1秒待機) を挿入してください。**
    - **安全高度の計算と利用**: 水平移動の前には、必ず `get_workpiece_catalog` を参照し、操作対象のワークに応じた安全高度を算出してください (例: 安全高度 = gripping_height + 50.0)。また、物体検出により高さ(h)が推定されている場合は、その高さに十分なマージンを加えた値を安全高度として考慮してください。
    - **衝突回避**: ワークを掴んだ後の水平移動は、必ず一度「安全高度」までアームを上昇させてから行ってください。低い高度のまま直線的に移動すると、他の物体と衝突する危険があります。
    """,
        'get_robot_status': """
    ロボットアームの現在の状態を取得します。
    **世界座標系（mm）**でのTCP座標、各関節の角度などが含まれる文字列を返します。
    動作計画を立てる前に、アームの現在位置を正確に把握するために使用してください。
    """,
        'get_joypad_state': """
    現在のジョイパッドの入力状態を取得します。
    戻り値 (JSON): {'X': float, 'Y': float, 'RX': float, 'RY': float}
    値は通常 -1.0 から 1.0 の範囲です。
    """,
        'get_live_image': """
    カメラから歪み補正済みのライブ映像や物体検出結果を取得します。
    返り値は `{"image_jpeg_base64": "...", "detections": [...]}` という形式のJSON文字列です。

    【座標系とパラメータの定義】
    - **x, y, z**: 世界座標系（ロボットベース原点）での3次元座標 (mm)。`execute_sequence` での移動指令にはこの値を使用します。
    - **r**: 物体の推定半径 (mm)。
    - **h**: 物体の推定高さ (mm)。
    - **u, v**: 画像上のピクセル座標 (ピクセル座標系, px)。
    - **u_norm, v_norm**: 画像サイズを0-1000に正規化した座標。
    - **u_top_norm, v_top_norm**: 物体上端中心の正規化画像座標 (0-1000)。
    - **radius_u_norm, radius_v_norm**: 正規化された画像上の半径（幅・高さ）。

    `detect_objects=True` の場合、検出された物体情報の `ground_center` に上記座標が含まれます。

    Args:
        visualize_axes (bool): Trueの場合、画像に座標軸を描画します。
        detect_objects (bool): Trueの場合、物体検出を行います。
        confidence (float): 検出の信頼度しきい値 (デフォルト0.7)。
        return_image (bool): Trueの場合、Base64エンコードされた画像を返します。Falseの場合、検出結果のみを返します。
    """,
        'convert_coordinates': """
    世界座標系、ArUcoマーカ座標系、ピクセル座標系の間で座標変換を行います。

    【座標系の定義】
    - 'world': 世界座標系（ロボットベース原点, mm）。
    - 'marker': ArUcoマーカ座標系（マーカー原点, mm）。
    - 'pixel': ピクセル座標系（画像上の u, v）。

    Args:
        x (float): X座標（ピクセルの場合は u）。
        y (float): Y座標（ピクセルの場合は v）。
        z (float): Z座標（デフォルト 0.0）。sourceが'pixel'の場合は無視されます（マーカー平面Z=0と仮定）。
        source (str): 変換元の座標系 ('world', 'marker', 'pixel')。
        target (str): 変換先の座標系 ('world', 'marker', 'pixel')。
    """,
    }
}

DOCS = TOOL_DOCS[LANG]

@mcp.tool()
@set_doc(DOCS['get_workpiece_catalog'])
def get_workpiece_catalog() -> str:
    return json.dumps(_fetch_workpiece_data(), ensure_ascii=False, indent=2)

@mcp.tool()
@set_doc(DOCS['execute_sequence'])
def execute_sequence(commands: str) -> str:
    return send_command(commands)

@mcp.tool()
@set_doc(DOCS['get_robot_status'])
def get_robot_status() -> str:
    return send_command("dump")

@mcp.tool()
@set_doc(DOCS['get_joypad_state'])
def get_joypad_state() -> str:
    return json.dumps(joypad_axis_values)

@mcp.tool()
@set_doc(DOCS['get_live_image'])
def get_live_image(visualize_axes: bool = True, detect_objects: bool = False, confidence: float = 0.7, return_image: bool = True) -> str:
    vs = get_vision_system()
    if not vs:
        return "Error: Vision system is not available."
    
    # 姿勢を更新。画像が不要でも検出には最新フレームが必要
    vs.update_pose(visualize_axes=visualize_axes)
    
    detections = None
    if detect_objects:
        model = get_yolo_model()
        if model:
            detections = vs.detect_objects(model, confidence)
        else:
            # 検出が要求されたがモデルがない場合はエラー
            return "Error: YOLO model not loaded."

    resp = {}
    if detections is not None:
        resp["detections"] = detections
    
    if return_image:
        base64_image = vs.get_undistorted_image_base64() # クライアント側で描画するため、サーバーでは描画しない
        if base64_image:
            resp["image_jpeg_base64"] = base64_image
        elif not resp: # 画像も検出結果もない場合
            return "Error: Failed to capture image from camera."
    
    return json.dumps(resp, ensure_ascii=False)

@mcp.tool()
@set_doc(DOCS['convert_coordinates'])
def convert_coordinates(x: float, y: float, z: float = 0.0, source: str = 'world', target: str = 'pixel') -> str:
    vs = get_vision_system()
    if not vs:
        return "Error: Vision system is not available."
    
    # Update pose
    vs.update_pose(visualize_axes=False)
    
    # 1. Normalize to Marker Coordinates (x_m, y_m, z_m)
    x_m, y_m, z_m = 0.0, 0.0, 0.0
    
    if source == 'world':
        x_m = x - ROBOT_BASE_OFFSET_X
        y_m = y - ROBOT_BASE_OFFSET_Y
        z_m = z
    elif source == 'marker':
        x_m = x
        y_m = y
        z_m = z
    elif source == 'pixel':
        # x is u, y is v
        # convert_2d_to_3d assumes Z=0 on marker plane
        coords, _ = vs.convert_2d_to_3d(x, y, draw_target=False)
        if not coords:
             return "Error: Could not convert pixel coordinates. Marker might not be visible."
        x_m = coords['x']
        y_m = coords['y']
        z_m = coords['z'] # 0.0
    else:
        return f"Error: Unknown source coordinate system '{source}'"

    # 2. Convert to Target
    if target == 'world':
        return json.dumps({
            "x": round(x_m + ROBOT_BASE_OFFSET_X, 1),
            "y": round(y_m + ROBOT_BASE_OFFSET_Y, 1),
            "z": round(z_m, 1)
        })
    elif target == 'marker':
        return json.dumps({
            "x": round(x_m, 1),
            "y": round(y_m, 1),
            "z": round(z_m, 1)
        })
    elif target == 'pixel':
        res = vs.convert_world_coords_to_image(x_m, y_m, z_m)
        if res:
            return json.dumps(res)
        else:
            return "Error: Could not project to pixel coordinates."
    else:
        return f"Error: Unknown target coordinate system '{target}'"

# --- ジョイパッド制御用 ---
joypad_axis_values = {'X': 0, 'Y': 0, 'RX': 0, 'RY': 0}
servo_pulse_widths = {'c0': 1500, 'c1': 1500, 'c2': 1500, 'c3': 1500}
JOYPAD_GAINS = {
    'c0': 0.05,
    'c1': 0.05,
    'c2': 0.05,
    'c3': 0.2
}

SERVO_LIMITS = {
    'c0': (500, 2500),
    'c1': (500, 2500),
    'c2': (1900, 2600),
    'c3': (2250, 2700), # Gripper
}

def joypad_control_loop():
    """ジョイパッド入力に基づくサーボ制御ループ"""
    # 接続確立と初期値同期のために少し待機
    time.sleep(3)
    print("Syncing servo positions from robot...")
    
    # 現状のステータスを取得
    status = send_command("dump")
    print(f"Initial Robot Status: {status}")
    
    # ステータスから現在のパルス幅を読み取って同期
    for cmd in servo_pulse_widths.keys():
        match = re.search(rf"{cmd}[=:\s]+(\d+)", status)
        if match:
            try:
                servo_pulse_widths[cmd] = float(match.group(1))
                print(f"Synced {cmd} -> {servo_pulse_widths[cmd]}")
            except ValueError:
                pass

    while True:
        # 軸とコマンドのマッピング
        # X -> c0, Y -> c2, RX -> c3, RY -> c1
        mappings = [('X', 'c0'), ('Y', 'c2'), ('RX', 'c3'), ('RY', 'c1')]
        
        for axis, cmd in mappings:
            val = joypad_axis_values.get(axis, 0)
            if abs(val) > 5: # Deadzone
                # パルス幅の更新 (入力値 -128~127 に応じて増減)
                # ゲイン調整
                delta = val * JOYPAD_GAINS.get(cmd, 0.05)
                if cmd in ['c0', 'c1', 'c2']:
                    servo_pulse_widths[cmd] -= delta
                else:
                    servo_pulse_widths[cmd] += delta
                
                # リミット適用
                min_val, max_val = SERVO_LIMITS.get(cmd, (500, 2500))
                servo_pulse_widths[cmd] = max(min_val, min(max_val, servo_pulse_widths[cmd]))
                
                # コマンド送信
                send_command(f"{cmd}={int(servo_pulse_widths[cmd])}")
        
        time.sleep(0.02) # 50Hz

# --- MJPEGストリーミングサーバー ---
class StreamingHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/stream.mjpg'):
            self.send_response(200)
            self.send_header('Age', '0')
            self.send_header('Cache-Control', 'no-cache, private')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            try:
                while True:
                    vs = get_vision_system()
                    if vs:
                        frame_bytes = vs.get_jpeg_bytes()
                        if frame_bytes:
                            self.wfile.write(b'--frame\r\n')
                            self.send_header('Content-Type', 'image/jpeg')
                            self.send_header('Content-Length', len(frame_bytes))
                            self.end_headers()
                            self.wfile.write(frame_bytes)
                            self.wfile.write(b'\r\n')
                        else:
                            time.sleep(0.05)
                    else:
                        time.sleep(0.1)
                    time.sleep(0.04) # ~25 FPS
            except Exception:
                pass
        else:
            self.send_error(404)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MCP Server for Robot Arm Control")
    parser.add_argument("--gui", action="store_true", help="Launch Vision GUI directly without starting the MCP server")
    parser.add_argument("--calib-gui", action="store_true", help="Launch Calibration GUI directly without starting the MCP server")
    parser.add_argument("--auto-gui", action="store_true", help="Automatically launch Vision GUI after starting the MCP server")
    parser.add_argument("--lang", type=str, default="ja", choices=["ja", "en"], help="Language (ja/en)")
    parser.add_argument("--model", type=str, default="best_20260208.pt", help="Path to YOLO model file (default: best.pt)")
    args = parser.parse_args()

    # グローバル設定の更新
    YOLO_MODEL_PATH = args.model

    # --- ジョイパッドサブシステムの起動 ---
    if get_joypad_system:
        try:
            jp = get_joypad_system()
            
            # 制御ループスレッドの開始
            ctrl_thread = threading.Thread(target=joypad_control_loop, daemon=True)
            ctrl_thread.start()

            def joypad_handler(cmd, value=None):
                # ここでジョイパッドの入力をロボット操作にマッピングします
                if cmd in joypad_axis_values and value is not None:
                    joypad_axis_values[cmd] = value
                elif cmd == "START":
                    print("[Joypad] START pressed -> Checking Status")
                    print(get_robot_status())
                elif value is None:
                    print(f"[Joypad] Button {cmd} pressed")
            
            jp.register_callback(joypad_handler)
            jp.start()
        except Exception as e:
            print(f"Joypad initialization failed: {e}")

    if args.gui:
        # GUIモードで起動
        vs = get_vision_system()
        if vs:
            vs.run_interactive_mode(command_callback=send_command)
            vs.release()
    elif args.calib_gui:
        if CalibrationGUI:
            calib_gui = CalibrationGUI(send_command, ROBOT_BASE_OFFSET_X, ROBOT_BASE_OFFSET_Y)
            calib_gui.run()
        else:
            print("CalibrationGUI is not available.")
    else:
        # MCPサーバーをバックグラウンドスレッドで起動し、メインスレッドはGUIイベントを待機する
        # (macOSなどではOpenCVのGUI操作はメインスレッドで行う必要があるため)
        def run_server():
            try:
                mcp.run(transport="streamable-http", host="0.0.0.0", port=8888)
            except Exception as e:
                print(f"Server error: {e}")

        server_thread = threading.Thread(target=run_server, daemon=True)
        server_thread.start()
        print("MCP Server running in background thread.")

        # MJPEGストリーミングサーバーの起動
        def run_mjpeg_server():
            try:
                socketserver.TCPServer.allow_reuse_address = True
                server = socketserver.ThreadingTCPServer(('0.0.0.0', 8000), StreamingHandler)
                server.daemon_threads = True
                print("MJPEG Streaming Server running on port 8000")
                server.serve_forever()
            except Exception as e:
                print(f"MJPEG Server error: {e}")
        
        mjpeg_thread = threading.Thread(target=run_mjpeg_server, daemon=True)
        mjpeg_thread.start()

        # 自動起動オプションがあればキューに入れる
        if args.auto_gui:
            gui_queue.put("launch")

        try:
            while True:
                try:
                    msg = gui_queue.get(timeout=1.0)
                    if msg == "launch":
                        vs = get_vision_system()
                        if vs:
                            vs.run_interactive_mode(command_callback=send_command)
                    elif msg == "launch_calib":
                        if CalibrationGUI:
                            calib_gui = CalibrationGUI(send_command, ROBOT_BASE_OFFSET_X, ROBOT_BASE_OFFSET_Y)
                            calib_gui.run()
                        else:
                            print("CalibrationGUI is not available.")
                except queue.Empty:
                    pass
        finally:
            # プログラム終了時に、確保したリソースを確実に解放する
            if _vision_system:
                _vision_system.release() # カメラを解放
                print("Vision system resources released.")