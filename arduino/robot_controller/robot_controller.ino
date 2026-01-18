#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <math.h>
#include <EEPROM.h>

/**
 * PHYSICAL PARAMETERS (Unit: mm)
 */
const float L1 = 80.0;          // Link 1: Shoulder (J2) to Elbow (J3)
const float L2 = 80.0;          // Link 2: Elbow (J3) to Wrist (J4)
const float L_OFF_J4_TCP = 53.0; // Horizontal offset from J4 to TCP
const float Z_OFF_J4_TCP = 10.0; // Vertical offset (How much TCP is below J4 axis)
const float OFF_J1_J2 = 15.0;    // Horizontal gap between J1 and J2
const float BASE_H = 57.0;       // Height of J2 axis from the mat surface

/**
 * MOTION CONTROL PARAMETERS
 */
const int STEPS = 60;            // Number of points in a straight path
const int STEP_DELAY = 10;       // Speed (ms between steps)

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();
#define SERVO_FREQ 50

struct Config {
  int signature; 
  int j_pulse[3][2];   // Pulse width for Calibration point 0 and 1
  float j_angle[3][2]; // Corresponding Ideal Angles
} conf;

float curX = 150.0, curY = 0.0, curZ = 50.0; // Robot's current TCP position
int current_us[3] = {1580, 1900, 2100};      // Current servo pulse widths

void setup() {
  Serial.begin(9600);
  pwm.begin();
  pwm.setPWMFreq(SERVO_FREQ);

  // Load Calibration from EEPROM
  EEPROM.get(0, conf);
  if (conf.signature != 0xABCD) {
    conf.signature = 0xABCD;
    // Initial safe defaults (Generic mapping)
    for(int i=0; i<3; i++) {
      conf.j_pulse[i][0] = 1000; conf.j_angle[i][0] = 0.0;
      conf.j_pulse[i][1] = 2000; conf.j_angle[i][1] = 90.0;
    }
  }
  
  // Set initial position
  runIK_Direct(curX, curY, curZ);
  Serial.println(F("--- ROBOT SYSTEM INITIALIZED ---"));
}

/**
 * SMOOTH STEP (Cubic Easing)
 * S(t) = 3t^2 - 2t^3
 */
float smoothStep(float t) {
  return t * t * (3.0 - 2.0 * t);
}

/**
 * ANGLE TO PULSE MAPPING (Linear Interpolation)
 * P = P0 + (theta - theta0) * (P1 - P0) / (theta1 - theta0)
 */
int angleToUs(int ch, float angle) {
  float p0 = conf.j_pulse[ch][0];
  float p1 = conf.j_pulse[ch][1];
  float a0 = conf.j_angle[ch][0];
  float a1 = conf.j_angle[ch][1];
  return (int)(p0 + (angle - a0) * (p1 - p0) / (a1 - a0));
}

/**
 * INVERSE KINEMATICS (IK) - Solving for J1, J2, J3
 * Calculates the joint angles required to reach a specific (x, y, z) coordinate.
 * @param x Target X coordinate (mm)
 * @param y Target Y coordinate (mm)
 * @param z Target Z coordinate (mm)
 * @param j1 Reference to store calculated Base angle
 * @param j2 Reference to store calculated Shoulder angle
 * @param j3 Reference to store calculated Elbow angle
 * @return true if the point is reachable, false otherwise
 */
bool calculateIK(float x, float y, float z, float &j1, float &j2, float &j3) {
  // 1. Base Rotation (J1): Calculate angle in the XY plane
  j1 = atan2(y, x) * 180.0 / PI;

  // 2. Find J4 (Wrist) Axis coordinates relative to J2 (Shoulder)
  // We need to work in the 2D plane formed by the arm extension.
  float r_total = sqrt(x*x + y*y); // Radial distance from base center (0,0) to target (x,y)
  float r_j4 = r_total - L_OFF_J4_TCP - OFF_J1_J2; // Horizontal distance from Shoulder (J2) to Wrist (J4)
  float z_j4 = (z + Z_OFF_J4_TCP) - BASE_H;        // Vertical distance from Shoulder (J2) to Wrist (J4)

  // 3. Solve triangle J2-J3-J4 (Shoulder-Elbow-Wrist) using Law of Cosines
  float s_sq = r_j4*r_j4 + z_j4*z_j4; // Square of the distance from Shoulder to Wrist
  float s = sqrt(s_sq);               // Distance from Shoulder to Wrist
  
  if (s > (L1 + L2) || s < abs(L1 - L2)) return false; // Check if target is physically reachable

  // Calculate Elbow Angle (J3)
  float cos_j3 = (L1*L1 + L2*L2 - s_sq) / (2.0 * L1 * L2); // Law of Cosines
  j3 = acos(cos_j3) * 180.0 / PI; // Result is in degrees

  // Calculate Shoulder Angle (J2)
  float a1 = atan2(z_j4, r_j4); // Angle of the vector from Shoulder to Wrist
  float a2 = acos((L1*L1 + s_sq - L2*L2) / (2.0 * L1 * s)); // Angle offset due to Elbow bend
  j2 = (a1 + a2) * 180.0 / PI; // Total shoulder angle

  return true;
}

/**
 * COORDINATE-BASED CALIBRATION
 * Tells the robot: "You are now at this XYZ on the mat."
 */
void registerCalib(int ptIdx, float x, float y, float z) {
  float tj1, tj2, tj3;
  if (calculateIK(x, y, z, tj1, tj2, tj3)) {
    conf.j_pulse[0][ptIdx] = current_us[0]; conf.j_angle[0][ptIdx] = tj1;
    conf.j_pulse[1][ptIdx] = current_us[1]; conf.j_angle[1][ptIdx] = tj2;
    conf.j_pulse[2][ptIdx] = current_us[2]; conf.j_angle[2][ptIdx] = tj3;
    Serial.print(F("Point ")); Serial.print(ptIdx); Serial.println(F(" set by Mat Coordinates."));
  } else {
    Serial.println(F("ERROR: Mat position is unreachable for IK."));
  }
}

/**
 * LINEAR STRAIGHT-LINE MOTION
 */
void moveTo(float tx, float ty, float tz) {
  float sx = curX, sy = curY, sz = curZ;
  for (int i = 1; i <= STEPS; i++) {
    float t_linear = (float)i / STEPS;
    float t_smooth = smoothStep(t_linear);
    
    // Cartesian Interpolation
    float ix = sx + (tx - sx) * t_smooth;
    float iy = sy + (ty - sy) * t_smooth;
    float iz = sz + (tz - sz) * t_smooth;

    float j1, j2, j3;
    if (calculateIK(ix, iy, iz, j1, j2, j3)) {
      moveServo(0, angleToUs(0, j1));
      moveServo(1, angleToUs(1, j2));
      moveServo(2, angleToUs(2, j3));
      delay(STEP_DELAY);
    }
  }
  curX = tx; curY = ty; curZ = tz;
  Serial.println(F("OK"));
}

void runIK_Direct(float x, float y, float z) {
  float j1, j2, j3;
  if (calculateIK(x, y, z, j1, j2, j3)) {
    moveServo(0, angleToUs(0, j1));
    moveServo(1, angleToUs(1, j2));
    moveServo(2, angleToUs(2, j3));
  }
}

void moveServo(int ch, int us) {
  if (ch < 0 || ch > 2) return;
  current_us[ch] = us;
  pwm.setPWM(ch, 0, (uint16_t)(us * 4096.0 / 20000.0));
}

/**
 * COMMAND HANDLER
 */
void loop() {
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd.startsWith("move")) {
      float tx = curX, ty = curY, tz = curZ;
      if(cmd.indexOf("x=") != -1) tx = cmd.substring(cmd.indexOf("x=")+2).toFloat();
      if(cmd.indexOf("y=") != -1) ty = cmd.substring(cmd.indexOf("y=")+2).toFloat();
      if(cmd.indexOf("z=") != -1) tz = cmd.substring(cmd.indexOf("z=")+2).toFloat();
      moveTo(tx, ty, tz);
    } 
    else if (cmd.startsWith("calib")) {
      int ptIdx = cmd.substring(5,6).toInt(); // calib0 or calib1
      float tx = 0, ty = 0, tz = 0;
      if(cmd.indexOf("x=") != -1) tx = cmd.substring(cmd.indexOf("x=")+2).toFloat();
      if(cmd.indexOf("y=") != -1) ty = cmd.substring(cmd.indexOf("y=")+2).toFloat();
      if(cmd.indexOf("z=") != -1) tz = cmd.substring(cmd.indexOf("z=")+2).toFloat();
      registerCalib(ptIdx, tx, ty, tz);
    }
    else if (cmd.startsWith("c")) { // Direct servo pulse control
      int ch = cmd.substring(1,2).toInt();
      int val = cmd.substring(cmd.indexOf('=')+1).toInt();
      moveServo(ch, val);
    }
    else if (cmd == "save") {
      EEPROM.put(0, conf);
      Serial.println(F("Config stored to EEPROM."));
    }
  }
}