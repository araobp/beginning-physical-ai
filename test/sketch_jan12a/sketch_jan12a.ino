#include "MsTimer2.h"

int incomingByte = 0;
bool blinking = false;
// int LED_PIN = 13;
int LED_PIN = 8;

void setup() {
  Serial.begin(9600);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  MsTimer2::set(200, led_control);
  MsTimer2::start();
}

void led_control() {
  static bool led_high = false;
  if (blinking) {
    if (led_high) {
      digitalWrite(LED_PIN, HIGH);
    } else {
      digitalWrite(LED_PIN, LOW);
    }
  }
  led_high = !led_high;
}

void loop() {
  if (Serial.available() > 0) {
    incomingByte = Serial.read();
    // Serial.print("I received: ");
    // Serial.println(incomingByte, HEX);
    if (incomingByte == 0x30) { // '0'
      blinking = false;
    } else if (incomingByte == 0x31) { // '1'
      blinking = true;
    }
  }
}