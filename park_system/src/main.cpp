#include <Arduino.h>
#include <ESP32Servo.h>

// ── ENTRY GATE ──────────────────────────────────────
#define ENTRY_TRIG_PIN  5
#define ENTRY_ECHO_PIN  18
#define ENTRY_SERVO_PIN 19
#define ENTRY_BTN_PIN   4

// ── EXIT GATE ───────────────────────────────────────
#define EXIT_TRIG_PIN   14
#define EXIT_ECHO_PIN   27
#define EXIT_SERVO_PIN  26
#define EXIT_BTN_PIN    13

// ── LEDs ────────────────────────────────────────────
#define ENTRY_GREEN_LED 23
#define ENTRY_RED_LED   22
#define EXIT_GREEN_LED  21
#define EXIT_RED_LED    25

Servo entryServo;
Servo exitServo;
bool entryGateOpen = false;
bool exitGateOpen  = false;

float readDistance(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long duration = pulseIn(echoPin, HIGH, 30000);
  return duration * 0.01723;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(ENTRY_TRIG_PIN, OUTPUT);
  pinMode(ENTRY_ECHO_PIN, INPUT);
  pinMode(EXIT_TRIG_PIN,  OUTPUT);
  pinMode(EXIT_ECHO_PIN,  INPUT);
  pinMode(ENTRY_BTN_PIN, INPUT_PULLUP);
  pinMode(EXIT_BTN_PIN,  INPUT_PULLUP);
  pinMode(ENTRY_GREEN_LED, OUTPUT);
  pinMode(ENTRY_RED_LED,   OUTPUT);
  pinMode(EXIT_GREEN_LED,  OUTPUT);
  pinMode(EXIT_RED_LED,    OUTPUT);
  entryServo.attach(ENTRY_SERVO_PIN);
  exitServo.attach(EXIT_SERVO_PIN);
  entryServo.write(0);
  exitServo.write(0);
  digitalWrite(ENTRY_GREEN_LED, HIGH);
  digitalWrite(ENTRY_RED_LED,   LOW);
  digitalWrite(EXIT_GREEN_LED,  HIGH);
  digitalWrite(EXIT_RED_LED,    LOW);
  Serial.println("SYSTEM_READY");
}

void loop() {
  float entryDist = readDistance(ENTRY_TRIG_PIN, ENTRY_ECHO_PIN);
  float exitDist  = readDistance(EXIT_TRIG_PIN,  EXIT_ECHO_PIN);

  Serial.print("ENTRY_DIST=");
  Serial.print(entryDist);
  Serial.print(" EXIT_DIST=");
  Serial.println(exitDist);

  bool entryTriggered = (digitalRead(ENTRY_BTN_PIN) == LOW) || (entryDist > 0 && entryDist < 30);
  bool exitTriggered  = (digitalRead(EXIT_BTN_PIN)  == LOW) || (exitDist  > 0 && exitDist  < 30);

  if (entryTriggered && !entryGateOpen) {
    Serial.println("CAR_AT_ENTRY");
    digitalWrite(ENTRY_GREEN_LED, LOW);
    digitalWrite(ENTRY_RED_LED,   HIGH);
    entryGateOpen = true;
    entryServo.write(90);
    delay(4000);
    entryServo.write(0);
    entryGateOpen = false;
    digitalWrite(ENTRY_RED_LED,   LOW);
    digitalWrite(ENTRY_GREEN_LED, HIGH);
  }

  if (exitTriggered && !exitGateOpen) {
    Serial.println("CAR_AT_EXIT");
    digitalWrite(EXIT_GREEN_LED, LOW);
    digitalWrite(EXIT_RED_LED,   HIGH);
    exitGateOpen = true;
    exitServo.write(90);
    delay(4000);
    exitServo.write(0);
    exitGateOpen = false;
    digitalWrite(EXIT_RED_LED,   LOW);
    digitalWrite(EXIT_GREEN_LED, HIGH);
  }

  delay(200);
}
