#include <Arduino.h>
#include <LiquidCrystal.h>
#include <Servo.h>

// LCD pins
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

// Ultrasonic sensor pins
#define t1 10
#define t2 9
#define t3 8

// IR sensor & servo
#define IR_SENSOR_PIN 7
#define SERVO_PIN 6

// LEDs
#define GREEN_LED1 A0
#define GREEN_LED2 A2
#define GREEN_LED3 A4

#define RED_LED1 A1
#define RED_LED2 A3
#define RED_LED3 A5

Servo servoMotor;
int distanceThreshold = 150;

void setup() {
  lcd.begin(16, 2);
  lcd.setCursor(0, 0);

  pinMode(IR_SENSOR_PIN, INPUT_PULLUP);

  pinMode(GREEN_LED1, OUTPUT);
  pinMode(GREEN_LED2, OUTPUT);
  pinMode(GREEN_LED3, OUTPUT);

  pinMode(RED_LED1, OUTPUT);
  pinMode(RED_LED2, OUTPUT);
  pinMode(RED_LED3, OUTPUT);

  servoMotor.attach(SERVO_PIN);

  Serial.begin(9600);
}

// Function to read distance
long readDistance(int pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(2);

  digitalWrite(pin, HIGH);
  delayMicroseconds(10);
  digitalWrite(pin, LOW);

  pinMode(pin, INPUT);
  return pulseIn(pin, HIGH);
}

// LED handling
void handleLEDs(float distance, int greenLedPin, int redLedPin) {
  if (distance >= distanceThreshold) {
    digitalWrite(greenLedPin, HIGH);
    digitalWrite(redLedPin, LOW);
    Serial.println("Empty slot!!");
  } else {
    digitalWrite(redLedPin, HIGH);
    digitalWrite(greenLedPin, LOW);
    Serial.println("Car is parked");
  }
}

void loop() {

  float d1 = 0.01723 * readDistance(t1);
  float d2 = 0.01723 * readDistance(t2);
  float d3 = 0.01723 * readDistance(t3);

  Serial.println("d1 = " + String(d1) + " cm");
  Serial.println("d2 = " + String(d2) + " cm");
  Serial.println("d3 = " + String(d3) + " cm");

  // IR sensor logic
  if (digitalRead(IR_SENSOR_PIN) == LOW) {
    if (d1 > 100 || d2 > 100 || d3 > 100) {
      servoMotor.write(90);
      delay(500);
      servoMotor.write(0);
      delay(500);
    }
  }

  // LEDs
  handleLEDs(d1, GREEN_LED1, RED_LED1);
  handleLEDs(d2, GREEN_LED2, RED_LED2);
  handleLEDs(d3, GREEN_LED3, RED_LED3);

  // LCD display
  if (d1 > 100 && d2 > 100 && d3 > 100) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("3 Slots Free");
    lcd.setCursor(0, 1);
    lcd.print("Slot 1 2 3 Free");
  }

  else if ((d1 > 100 && d2 > 100) || (d2 > 100 && d3 > 100) || (d3 > 100 && d1 > 100)) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("2 Slots Free");
    lcd.setCursor(0, 1);

    if (d1 > 100 && d2 > 100)
      lcd.print("Slot 1 & 2 Free");
    else if (d1 > 100 && d3 > 100)
      lcd.print("Slot 1 & 3 Free");
    else
      lcd.print("Slot 2 & 3 Free");
  }

  else if (d1 < 100 && d2 < 100 && d3 < 100) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("No Slot Free");
    lcd.setCursor(0, 1);
    lcd.print("Parking Full");
  }

  else {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("1 Slot Free");
    lcd.setCursor(0, 1);

    if (d1 > 100)
      lcd.print("Slot 1 Free");
    else if (d2 > 100)
      lcd.print("Slot 2 Free");
    else
      lcd.print("Slot 3 Free");
  }

  delay(500);
}