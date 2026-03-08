#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <math.h>
#include <EEPROM.h>

/**
 * @file robot_controller.ino
 * @brief Firmware for a 4-DOF robotic arm controller.
 * 
 * This code manages the low-level control of a 4-DOF robotic arm using an Adafruit PWM Servo Driver.
 * It handles serial commands for movement, calibration, and status reporting.
 * Key features include:
 * - Inverse Kinematics (IK) to translate XYZ coordinates to joint angles.
 * - Linear interpolation for smooth servo movements.
 * - EEPROM storage for calibration data to persist across power cycles.
 * - A serial command interface for integration with a higher-level controller (e.g., a Python server).
 * - Support for aborting command sequences via 'abort' command.
 */

// --- Physical Parameters of the Robot Arm (in millimeters) ---
const float L1 = 80.0;           // Length of the first arm segment (shoulder to elbow).
const float L2 = 80.0;           // Length of the second arm segment (elbow to wrist joint).
const float L_OFF_J4_TCP = 51.0; // Horizontal offset from the wrist joint (J4) to the Tool Center Point (TCP).
const float Z_OFF_J4_TCP = 8.0;  // Vertical offset from the wrist joint (J4) to the TCP.
const float OFF_J1_J2 = 15.0;    // Horizontal offset between the base rotation joint (J1) and the shoulder joint (J2).
const float BASE_H = 56.0;       // Height of the robot's base.

// --- Gripper Width to Percentage Mapping ---
const float GRIP_WIDTH_MIN_MM = 0.0;    // Minimum grip width in mm that can be specified.
const float GRIP_WIDTH_MAX_MM = 25.0;   // Maximum grip width in mm that can be specified.
const int GRIP_P_FOR_MIN_WIDTH = 10;    // Servo percentage for the minimum specified width.
const int GRIP_P_FOR_MAX_WIDTH = 50;    // Servo percentage for the maximum specified width.

// --- Servo Control Configuration ---
const int STEP_DELAY = 10;       // Delay in milliseconds between each step of an interpolated movement, controlling smoothness.
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();
#define SERVO_FREQ 50            // Standard PWM frequency for analog servos (50 Hz -> 20ms period).

/**
 * @struct Config
 * @brief Defines the configuration data structure to be stored in EEPROM.
 * This allows calibration and settings to be persistent.
 */
struct Config {
  int signature;       // A magic number (e.g., 0xABCD) to verify that the EEPROM data is valid.
  int j_pulse[3][2];   // Stores two pulse width values for each of the 3 main joints [joint][point]. Used for calibration.
  float j_angle[3][2]; // Stores the two corresponding angles (in degrees) for the pulse widths above.
  int grip_open;       // The servo pulse width (in microseconds) for the fully open gripper position.
  int grip_close;      // The servo pulse width for the fully closed gripper position.
  int grip_speed_ms;   // The total time (in milliseconds) it should take for the gripper to open or close.
} conf;

// --- Global State Variables ---
float curX = 150.0, curY = 0.0, curZ = 50.0;  // Current logical XYZ coordinates of the Tool Center Point (TCP).
int current_us[4] = {1500, 1500, 1500, 1500}; // Current pulse width in microseconds for each servo channel (0-3).
int cmd_interval_ms = 0;                      // Optional delay between semicolon-separated commands in a sequence.

/**
 * @brief Saves the current configuration `conf` struct to EEPROM.
 */
void saveConfig() {
  EEPROM.put(0, conf);
}

/**
 * @brief Drives a single servo to a specified pulse width.
 * @param ch The servo channel (0-3).
 * @param us The target pulse width in microseconds (e.g., 500-2500).
 */
void moveServo(int ch, int us) {
  if (ch < 0 || ch > 3) return;
  current_us[ch] = us;
  pwm.setPWM(ch, 0, (uint16_t)(us * 4096.0 / 20000.0));
}

/**
 * @brief Converts a desired joint angle (in degrees) to a servo pulse width (in microseconds).
 * Uses linear interpolation based on the two calibration points stored in the `conf` struct.
 * @param ch The joint/channel to convert for (0-2).
 * @param angle The desired angle in degrees.
 * @return The calculated pulse width in microseconds.
 */
int angleToUs(int ch, float angle) {
  float p0 = (float)conf.j_pulse[ch][0], p1 = (float)conf.j_pulse[ch][1];
  float a0 = conf.j_angle[ch][0], a1 = conf.j_angle[ch][1];
  if (abs(a1 - a0) < 0.01) return (int)p0; 
  return (int)(p0 + (angle - a0) * (p1 - p0) / (a1 - a0));
}

/**
 * @brief Converts a servo pulse width (in microseconds) to a joint angle (in degrees).
 * This is the inverse of `angleToUs`.
 * @param ch The joint/channel to convert for (0-2).
 * @param us The current pulse width in microseconds.
 * @return The calculated angle in degrees.
 */
float usToAngle(int ch, int us) {
  float p0 = (float)conf.j_pulse[ch][0], p1 = (float)conf.j_pulse[ch][1];
  float a0 = conf.j_angle[ch][0], a1 = conf.j_angle[ch][1];
  if (abs(p1 - p0) < 1) return a0; // Avoid division by zero or near-zero
  return a0 + ((float)us - p0) * (a1 - a0) / (p1 - p0);
}

/**
 * @brief Calculates the required joint angles for a target XYZ coordinate using Inverse Kinematics (IK).
 * @param x The target X coordinate (in mm).
 * @param y The target Y coordinate (in mm).
 * @param z The target Z coordinate (in mm).
 * @param j1 Reference to store the calculated base angle (in degrees).
 * @param j2 Reference to store the calculated shoulder angle (in degrees).
 * @param j3 Reference to store the calculated elbow angle (in degrees).
 * @return `true` if the target is reachable, `false` otherwise.
 */
bool calculateIK(float x, float y, float z, float &j1, float &j2, float &j3) {
  j1 = atan2(y, x) * 180.0 / PI;
  float r_total = sqrt(x*x + y*y);
  float r_j4 = r_total - L_OFF_J4_TCP - OFF_J1_J2;
  float z_j4 = (z + Z_OFF_J4_TCP) - BASE_H;
  float s_sq = r_j4*r_j4 + z_j4*z_j4;
  float s = sqrt(s_sq);
  
  // Check if the target is within the reachable workspace.
  if (s > (L1 + L2) || s < abs(L1 - L2)) return false;

  float t3 = acos((L1*L1 + L2*L2 - s_sq) / (2.0 * L1 * L2)) * 180.0 / PI;
  float t2 = acos((L1*L1 + s_sq - L2*L2) / (2.0 * L1 * s)) * 180.0 / PI;
  
  j2 = atan2(z_j4, r_j4) * 180.0 / PI + t2;
  j3 = t3 + j2; 
  return true;
}

/**
 * @brief Moves the robot's TCP smoothly to a target coordinate.
 * It interpolates the path into small steps and calculates IK for each step.
 * @param tx Target X coordinate.
 * @param ty Target Y coordinate.
 * @param tz Target Z coordinate.
 * @param speed Movement speed factor (0-100). Higher is faster.
 */
void moveTo(float tx, float ty, float tz, float speed) {
  float sx = curX, sy = curY, sz = curZ;
  float dist = sqrt(sq(tx - sx) + sq(ty - sy) + sq(tz - sz));
  int steps = max(1, (int)((dist / max(1.0f, speed)) * 1000.0 / STEP_DELAY));
  
  for (int i = 1; i <= steps; i++) {
    float t = (float)i / steps;
    float easedT = t * t * (3.0 - 2.0 * t); // Smoothstep easing function for acceleration/deceleration.
    
    float j1, j2, j3;
    if (calculateIK(sx+(tx-sx)*easedT, sy+(ty-sy)*easedT, sz+(tz-sz)*easedT, j1, j2, j3)) {
      moveServo(0, angleToUs(0, j1)); 
      moveServo(1, angleToUs(1, j2)); 
      moveServo(2, angleToUs(2, j3));
      delay(STEP_DELAY);
    }
  }
  curX = tx; curY = ty; curZ = tz;
}

/**
 * @brief Parses and executes a single command string received via serial.
 * @param cmd The command string to execute.
 */
void executeCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  // Command: 'move x=... y=... z=... s=...'
  // Moves the arm to the specified world coordinates.
  if (cmd.startsWith("move")) {
    float tx = curX, ty = curY, tz = curZ, speed = 50.0;
    if(cmd.indexOf("x=") != -1) tx = cmd.substring(cmd.indexOf("x=")+2).toFloat();
    if(cmd.indexOf("y=") != -1) ty = cmd.substring(cmd.indexOf("y=")+2).toFloat();
    if(cmd.indexOf("z=") != -1) tz = cmd.substring(cmd.indexOf("z=")+2).toFloat();
    if(cmd.indexOf("s=") != -1) speed = cmd.substring(cmd.indexOf("s=")+2).toFloat();
    moveTo(tx, ty, tz, speed);
  } 
  // Command: 'calibg <open|close>'
  // Calibrates the gripper's open or close position based on the current servo pulse.
  else if (cmd.startsWith("calibg")) {
    if (cmd.indexOf("open") != -1) {
      conf.grip_open = current_us[3];
      Serial.print(F("Grip OPEN registered: ")); Serial.println(conf.grip_open);
    } else if (cmd.indexOf("close") != -1) {
      conf.grip_close = current_us[3];
      Serial.print(F("Grip CLOSE registered: ")); Serial.println(conf.grip_close);
    } else {
      Serial.println(F("Usage: calibg <open|close>"));
    }
  }
  // Command: 'calib<0|1> x=... y=... z=...'
  // Registers one of the two calibration points for the main joints.
  else if (cmd.startsWith("calib")) {
    int ptIdx = cmd.substring(5,6).toInt();
    float tx=0, ty=0, tz=0;
    if(cmd.indexOf("x=") != -1) tx = cmd.substring(cmd.indexOf("x=")+2).toFloat();
    if(cmd.indexOf("y=") != -1) ty = cmd.substring(cmd.indexOf("y=")+2).toFloat();
    if(cmd.indexOf("z=") != -1) tz = cmd.substring(cmd.indexOf("z=")+2).toFloat();
    float tj1, tj2, tj3;
    if (calculateIK(tx, ty, tz, tj1, tj2, tj3)) {
      conf.j_pulse[0][ptIdx] = current_us[0]; conf.j_angle[0][ptIdx] = tj1;
      conf.j_pulse[1][ptIdx] = current_us[1]; conf.j_angle[1][ptIdx] = tj2;
      conf.j_pulse[2][ptIdx] = current_us[2]; conf.j_angle[2][ptIdx] = tj3; 
      Serial.print(F("Point ")); Serial.print(ptIdx); Serial.println(F(" IK registered."));
    }
  }
  // Command: 'grip <open|close>'
  // Moves the gripper to its calibrated open or close position.
  else if (cmd.startsWith("grip")) {
    int start_us = current_us[3];
    int p_val;

    // Determine target percentage 'p_val'. 'p=' takes precedence.
    if (cmd.indexOf("p=") != -1) {
      p_val = cmd.substring(cmd.indexOf("p=")+2).toInt();
    } else if (cmd.indexOf("open") != -1) {
      p_val = 50; // 'open' keyword is equivalent to 50% open.
    } else if (cmd.indexOf("close") != -1) {
      // Support `grip close <width_mm>`
      String sub = cmd.substring(cmd.indexOf("close") + 5);
      sub.trim();
      // Check if a width value is provided
      if (sub.length() > 0 && (isDigit(sub.charAt(0)) || sub.charAt(0) == '-')) {
        float width_mm = sub.toFloat();
        width_mm = max(GRIP_WIDTH_MIN_MM, min(GRIP_WIDTH_MAX_MM, width_mm)); // Clamp width to the defined range.
        // Linearly map the specified width (e.g., 0-25mm) to a servo percentage (e.g., 10-50%).
        p_val = (int)(GRIP_P_FOR_MIN_WIDTH + (width_mm - GRIP_WIDTH_MIN_MM) * (GRIP_P_FOR_MAX_WIDTH - GRIP_P_FOR_MIN_WIDTH) / (GRIP_WIDTH_MAX_MM - GRIP_WIDTH_MIN_MM));
      } else {
        p_val = 0; // Default 'grip close' (no width specified) is 0%.
      }
    } else { // 'close' keyword or no keyword defaults to 0%.
      p_val = 0;
    }
    
    p_val = max(0, min(100, p_val)); // Clamp percentage to a valid range [0, 100].
    int target_us = map(p_val, 0, 100, conf.grip_close, conf.grip_open);
    
    // Parse speed parameter (s=1-100), default to 50.
    float speed = 50.0;
    if(cmd.indexOf("s=") != -1) {
      speed = cmd.substring(cmd.indexOf("s=")+2).toFloat();
    }
    speed = max(1.0, min(100.0, speed)); // Clamp speed to 1-100 range.

    // Map speed (1-100) to duration. Speed 1 is slowest, 100 is fastest.
    const long MAX_GRIP_DURATION_MS = 2000;
    const long MIN_GRIP_DURATION_MS = 100;
    long duration_ms = map((long)speed, 1, 100, MAX_GRIP_DURATION_MS, MIN_GRIP_DURATION_MS);

    int steps = max(1, (int)(duration_ms / STEP_DELAY));
    for (int i = 1; i <= steps; i++) {
      moveServo(3, start_us + (int)((target_us - start_us) * (float)i / steps));
      delay(STEP_DELAY);
    }
  }
  // Command: 'delay t=...' or 'delay ...'
  // Pauses execution for a specified number of milliseconds.
  else if (cmd.startsWith("delay")) {
    int t = 1;
    if(cmd.indexOf("t=") != -1) {
      t = cmd.substring(cmd.indexOf("t=")+2).toInt();
    } else {
      String s = cmd.substring(5);
      s.trim();
      if (s.length() > 0) t = s.toInt();
    }
    unsigned long start = millis();
    delay(t);
  }
  // Command: 'cmdint=...'
  // Sets the delay between semicolon-separated commands.
  else if (cmd.startsWith("cmdint")) {
    int val = 0;
    if (cmd.indexOf('=') != -1) val = cmd.substring(cmd.indexOf('=')+1).toInt();
    else val = cmd.substring(6).toInt();
    cmd_interval_ms = val;
  }
  // Command: 'c<ch>=<us>'
  // Directly controls a servo channel by setting its pulse width.
  else if (cmd.startsWith("c")) {
    // Direct channel control (e.g., c0=1500)
    int eqIdx = cmd.indexOf('=');
    if (eqIdx != -1) {
      int ch = cmd.substring(1, eqIdx).toInt();
      int us = cmd.substring(eqIdx + 1).toInt();
      moveServo(ch, us);
    }
  }
  // Command: 'save'
  // Saves the current calibration configuration to EEPROM.
  else if (cmd == "save") { 
    saveConfig(); 
    Serial.println(F("Config Saved to EEPROM.")); 
  }
  // Command: 'dump'
  // Prints the current configuration and robot state to the serial monitor.
  else if (cmd == "dump") {
    Serial.print(F("{\"joints\":["));
    for(int i=0; i<3; i++) {
      Serial.print(F("{\"ch\":")); Serial.print(i);
      Serial.print(F(",\"p0\":")); Serial.print(conf.j_pulse[i][0]);
      Serial.print(F(",\"a0\":")); Serial.print(conf.j_angle[i][0], 1);
      Serial.print(F(",\"p1\":")); Serial.print(conf.j_pulse[i][1]);
      Serial.print(F(",\"a1\":")); Serial.print(conf.j_angle[i][1], 1);
      Serial.print(F(",\"cur_us\":")); Serial.print(current_us[i]);
      Serial.print(F(",\"cur_angle\":")); Serial.print(usToAngle(i, current_us[i]), 1);
      Serial.print(F("}"));
      if(i<2) Serial.print(F(","));
    }
    Serial.print(F("],\"gripper\":{\"open\":")); Serial.print(conf.grip_open);
    Serial.print(F(",\"close\":")); Serial.print(conf.grip_close);
    Serial.print(F(",\"speed\":")); Serial.print(conf.grip_speed_ms);
    Serial.print(F(",\"cur_us\":")); Serial.print(current_us[3]);
    Serial.print(F("},\"tcp\":{\"x\":")); Serial.print(curX);
    Serial.print(F(",\"y\":")); Serial.print(curY);
    Serial.print(F(",\"z\":")); Serial.print(curZ);
    Serial.println(F("}}"));
  }
  // Command: 'status'
  // Prints the current configuration and robot state in JSON format.
  else if (cmd == "status") {
    Serial.println(F("\n--- CONFIG DUMP ---"));
    for(int i=0; i<3; i++) {
      Serial.print("Ch"); Serial.print(i);
      Serial.print(": [P0="); Serial.print(conf.j_pulse[i][0]);
      Serial.print(", A0="); Serial.print(conf.j_angle[i][0], 1);
      Serial.print("] [P1="); Serial.print(conf.j_pulse[i][1]);
      Serial.print(", A1="); Serial.print(conf.j_angle[i][1], 1);
      Serial.print("] | CUR="); Serial.print(current_us[i]);
      Serial.print(" ("); Serial.print(usToAngle(i, current_us[i]), 1);
      Serial.println(" deg)");
    }
    Serial.print(F("Grip: Open=")); Serial.print(conf.grip_open);
    Serial.print(F(", Close=")); Serial.print(conf.grip_close);
    Serial.print(F(" | CUR=")); Serial.println(current_us[3]);
    Serial.print(F("Current Logic TCP: X=")); Serial.print(curX);
    Serial.print(F(" Y=")); Serial.print(curY);
    Serial.print(F(" Z=")); Serial.println(curZ);
    Serial.println(F("-------------------\n"));
  }
  // Command: 'help'
  // Prints a list of available commands.
  else if (cmd == "help") {
    Serial.println(F("\n--- COMMAND HELP ---"));
    Serial.println(F("[Movement]"));
    Serial.println(F("  move x=.. y=.. z=.. s=..      : Move TCP to world coordinates (speed 1-100)."));
    Serial.println(F("  c<ch>=<us>                    : Direct servo control by pulse width (e.g., c0=1500)."));
    Serial.println(F(""));
    Serial.println(F("[Gripper]"));
    Serial.println(F("  grip <p=..|open|close [width]> [s=..] : Control gripper. p=%, open=50%, close to [width]mm (0-25). s=speed 1-100."));
    Serial.println(F(""));
    Serial.println(F("[Calibration & Config]"));
    Serial.println(F("  calib<0|1> x=.. y=.. z=..     : Register IK calibration point (0 or 1)."));
    Serial.println(F("  calibg <open|close>           : Register gripper open/close pulse limits."));
    Serial.println(F("  save                          : Save current calibration to EEPROM."));
    Serial.println(F("  cmdint <ms>                   : Set interval between sequenced commands."));
    Serial.println(F(""));
    Serial.println(F("[Status & Utility]"));
    Serial.println(F("  dump                          : Get robot status as JSON."));
    Serial.println(F("  status                        : Get robot status as human-readable text."));
    Serial.println(F("  delay <ms>                    : Pause execution for <ms> milliseconds."));
    Serial.println(F("  help                          : Display this help message."));
    Serial.println(F("--------------------\n"));
  }
  else {
    Serial.print(F("Unknown Command: ")); Serial.println(cmd);
  }
}

/**
 * @brief Setup function, runs once on startup.
 * Initializes Serial, PWM driver, loads configuration from EEPROM, and moves to a safe start position.
 */
void setup() {
  Serial.begin(9600);
  pwm.begin();
  pwm.setPWMFreq(SERVO_FREQ);

  // Load config from EEPROM. If the signature is invalid, initialize with default values and save.
  EEPROM.get(0, conf);
  if (conf.signature != 0xABCD) {
    conf.signature = 0xABCD;
    for(int i=0; i<3; i++) {
      conf.j_pulse[i][0] = 1500; conf.j_angle[i][0] = 0.0;
      conf.j_pulse[i][1] = 2000; conf.j_angle[i][1] = 45.0;
    }
    conf.grip_open = 1000; conf.grip_close = 2000; conf.grip_speed_ms = 300;
    EEPROM.put(0, conf);
  }
  
  // Move to a safe, neutral starting position.
  float j1, j2, j3;
  float startX = 130.0, startY = 0.0, startZ = 40.0;
  if (calculateIK(startX, startY, startZ, j1, j2, j3)) {
    moveServo(0, angleToUs(0, j1));
    moveServo(1, angleToUs(1, j2));
    moveServo(2, angleToUs(2, j3));
    curX = startX; curY = startY; curZ = startZ;
  } else {
    // If IK fails for the start position (e.g., bad calibration), move to a raw default pulse.
    for(int i=0; i<3; i++) moveServo(i, 1500);
  }
  moveServo(3, (conf.grip_open + conf.grip_close) / 2); // Gripper to neutral

  Serial.println(F("--- ROBOT SYSTEM v3.8 (20260308) Ready ---"));
}

/**
 * @brief Main loop, runs continuously.
 * Listens for incoming serial commands, parses them, and executes them.
 * Handles command sequences separated by semicolons ';'.
 */
void loop() {
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    int startIdx = 0;
    int delimiterIdx = input.indexOf(';');

    // Process each command in a semicolon-separated sequence.
    while (delimiterIdx != -1) {
      executeCommand(input.substring(startIdx, delimiterIdx));
      Serial.println(";"); // Send acknowledgment ';' after each sub-command.
      if (cmd_interval_ms > 0) delay(cmd_interval_ms);
      startIdx = delimiterIdx + 1;
      delimiterIdx = input.indexOf(';', startIdx);
    }
    
    executeCommand(input.substring(startIdx));
    Serial.println(";"); // Acknowledgment for the last command.
    
    Serial.println(("!")); // Send final prompt '!' to signal the end of the entire sequence.
  }
}