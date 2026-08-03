// Data Center Environmental Sensor Logger
// Sensors: DHT22 (Temp + Humidity) + BMP280 (Pressure + Temp)
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_BMP280.h>

#define DHT_PIN 2
#define DHT_TYPE DHT22
#define BMP280_ADDR 0x76

DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_BMP280 bmp;
int readingNumber = 0;

void setup() {
  Serial.begin(9600);
  delay(1000);
  Serial.println("Data Center Sensor Logger v1.0");
  dht.begin();
  if (!bmp.begin(BMP280_ADDR)) {
    Serial.println("[ERROR] BMP280 not found! Check wiring.");
    while (1) delay(500);
  }
  bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                  Adafruit_BMP280::SAMPLING_X2,
                  Adafruit_BMP280::SAMPLING_X16,
                  Adafruit_BMP280::FILTER_X16,
                  Adafruit_BMP280::STANDBY_MS_500);
  Serial.println("# | Temp(C) | Temp(F) | Humidity | Pressure | Altitude");
}

void loop() {
  delay(3000);
  readingNumber++;
  float humidity = dht.readHumidity();
  float tempC = dht.readTemperature();
  float tempF = dht.readTemperature(true);
  float pressureHPa = bmp.readPressure() / 100.0F;
  float altitudeM = bmp.readAltitude(1013.25);

  if (isnan(humidity) || isnan(tempC)) {
    Serial.println("[ERROR] DHT22 failed to read. Check wiring!");
    return;
  }

  Serial.print(readingNumber);
  Serial.print(" | ");
  Serial.print(tempC, 1);
  Serial.print("C | ");
  Serial.print(tempF, 1);
  Serial.print("F | ");
  Serial.print(humidity, 1);
  Serial.print("% | ");
  Serial.print(pressureHPa, 2);
  Serial.print(" hPa | ");
  Serial.print(altitudeM, 1);
  Serial.println(" m");

  if (tempC > 27.0) Serial.println("WARNING: Above ASHRAE recommended max inlet temp (27C)");
  if (humidity < 40.0) Serial.println("WARNING: Humidity below ASHRAE minimum (40% RH)");
  if (humidity > 60.0) Serial.println("WARNING: Humidity above ASHRAE maximum (60% RH)");
}
