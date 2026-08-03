# Arduino Edge Component

## Included sketch

`data_center_environmental_sensor_logger.ino` reads a DHT22 and BMP280 and prints temperature, humidity, pressure, and estimated altitude to the Arduino Serial Monitor at 9600 baud. It also prints warnings for inlet temperature above 27 C and humidity outside 40–60% RH.

## Hardware and wiring

- Arduino Uno/Nano or compatible board. This historical sketch was documented for an Uno/Nano; it has not been hardware-verified here on an Arduino R4 WiFi or R4 Minima.
- DHT22: VCC to 5V, GND to GND, DATA to digital pin 2. Use a 10 kOhm pull-up resistor if using the bare sensor rather than a module.
- BMP280 in I2C mode: VCC to 3.3V, GND to GND, SDA to A4, SCL to A5 on Uno/Nano. The sketch expects address `0x76` (SDO tied to GND).

For Arduino R4 boards, use the board's labeled I2C SDA/SCL pins rather than assuming Uno A4/A5 placement. Confirm the BMP280 module's voltage and I2C address before powering it.

## Upload steps

1. In Arduino IDE Library Manager, install **DHT sensor library** by Adafruit, **Adafruit Unified Sensor**, and **Adafruit BMP280 Library**.
2. Open `data_center_environmental_sensor_logger.ino`, select the connected board and port, and upload.
3. Open Serial Monitor at 9600 baud.

## Images

Place photos of the assembled project, sensors, and any Arduino R4 WiFi/R4 Minima runs in `images/`. This folder is intentionally empty until real photos are supplied.
