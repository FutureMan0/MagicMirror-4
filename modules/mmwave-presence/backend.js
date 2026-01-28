const { exec } = require('child_process');
const fs = require('fs');

/**
 * mmWave Presence Sensor Backend
 * Works on Raspberry Pi with 24GHz mmWave Sensor (XIAO)
 */
module.exports = {
    registerRoutes: (app, context) => {
        let config = {
            port: '/dev/ttyAMA0',
            baudRate: 256000,
            sensitivity: 40,
            offDelay: 60
        };

        // Load config from context if possible
        try {
            if (context && context.ConfigManager) {
                const configManager = new context.ConfigManager(context.instanceName);
                const fullConfig = configManager.loadConfig();
                const moduleConfig = fullConfig.modules.find(m => m.name === 'mmwave-presence');
                if (moduleConfig && moduleConfig.config) {
                    config = { ...config, ...moduleConfig.config };
                }
            }
        } catch (e) {
            console.error("Presence Backend: Error loading config", e);
        }

        let lastPresence = Date.now();
        let isPersonPresent = false;
        let displayPower = true;
        let buffer = Buffer.alloc(0);

        const HEADER = Buffer.from([0xF4, 0xF3, 0xF2, 0xF1]);
        const TAIL = Buffer.from([0xF8, 0xF7, 0xF6, 0xF5]);

        /**
         * Controls the display power via vcgencmd
         */
        const setDisplay = (power) => {
            if (displayPower === power) return;
            displayPower = power;

            console.log(`Presence: Turning display ${power ? 'ON' : 'OFF'}`);

            // Notify renderer for software dimming
            try {
                const { BrowserWindow } = require('electron');
                const wins = BrowserWindow.getAllWindows();
                wins.forEach(win => {
                    win.webContents.send(power ? 'presence-detected' : 'presence-lost');
                });
            } catch (ipcErr) {
                console.error("Presence: Could not send IPC to renderer", ipcErr.message);
            }

            // Control Raspberry Pi display hardware
            exec(`vcgencmd display_power ${power ? 1 : 0}`, (err) => {
                if (err) {
                    // Fallback or log error
                    console.error("Presence: vcgencmd display_power failed", err.message);
                    // Try xset as fallback if running in X11
                    exec(`export DISPLAY=:0 && xset dpms force ${power ? 'on' : 'off'}`, () => { });
                }
            });
        };

        /**
         * Sends configuration commands to the sensor
         */
        const setSensitivity = (val) => {
            if (process.platform !== 'linux') return;

            try {
                const fd = fs.openSync(config.port, 'w');

                // 1. Enable Configuration Mode
                const enable = Buffer.from([0xFD, 0xFC, 0xFB, 0xFA, 0x04, 0x00, 0xFF, 0x00, 0x01, 0x00, 0x04, 0x03, 0x02, 0x01]);
                fs.writeSync(fd, enable);

                // 2. Set Sensitivity (waits shortly to ensure sensor is ready)
                setTimeout(() => {
                    const setCmd = Buffer.alloc(30);
                    setCmd.writeUInt32LE(0xFAFBFCFD, 0); // Header (FD FC FB FA)
                    setCmd.writeUInt16LE(20, 4);          // Length of data
                    setCmd.writeUInt16LE(0x0064, 6);      // Command: Set Sensitivity
                    setCmd.writeUInt16LE(0x0000, 8);      // Para: Distance Gate (0)
                    setCmd.writeUInt32LE(0x0000FFFF, 10); // Value: 0xFFFF (All gates)
                    setCmd.writeUInt16LE(0x0001, 14);     // Para: Motion Sensitivity
                    setCmd.writeUInt32LE(val, 16);        // Value: Sensitivity (0-100)
                    setCmd.writeUInt16LE(0x0002, 20);     // Para: Static Sensitivity
                    setCmd.writeUInt32LE(val, 22);        // Value: Sensitivity (0-100)
                    setCmd.writeUInt32LE(0x01020304, 26); // Tail (04 03 02 01)

                    fs.writeSync(fd, setCmd);

                    // 3. End Configuration Mode
                    setTimeout(() => {
                        const end = Buffer.from([0xFD, 0xFC, 0xFB, 0xFA, 0x02, 0x00, 0xFE, 0x00, 0x04, 0x03, 0x02, 0x01]);
                        fs.writeSync(fd, end);
                        fs.closeSync(fd);
                        console.log(`Presence: Sensor sensitivity updated to ${val}%`);
                    }, 150);
                }, 150);
            } catch (e) {
                console.error("Presence: Failed to write to sensor port", e.message);
            }
        };

        /**
         * Parses the reporting data frames from the sensor
         */
        const parseFrame = (frameData) => {
            // frameData starts with Length (bytes 0-1)
            const dataType = frameData[2];
            const head = frameData[3];

            // DataType 0x02 = Basic Target Info, 0xAA = Protocol Header
            if (head === 0xAA && (dataType === 0x01 || dataType === 0x02)) {
                const targetStatus = frameData[4];

                // Status: 0x00=None, 0x01=Moving, 0x02=Static, 0x03=Both
                if (targetStatus > 0) {
                    lastPresence = Date.now();
                    if (!isPersonPresent) {
                        isPersonPresent = true;
                        setDisplay(true); // Wake up immediately
                    }
                } else {
                    isPersonPresent = false;
                }
            }
        };

        const startSerial = () => {
            console.log(`Presence: Opening sensor on ${config.port} at ${config.baudRate} baud...`);

            // Configure Serial Port using stty (standard on Linux/RPi)
            exec(`stty -F ${config.port} ${config.baudRate} raw -echo`, (err) => {
                if (err) {
                    console.error(`Presence: Port ${config.port} not available or stty failed. Error: ${err.message}`);
                    return;
                }

                // Apply sensitivity configuration to the sensor hardware
                setSensitivity(config.sensitivity);

                // Read binary stream from serial port
                const stream = fs.createReadStream(config.port);
                stream.on('data', (chunk) => {
                    buffer = Buffer.concat([buffer, chunk]);

                    // Process buffer for frames
                    while (buffer.length >= 10) {
                        const hIdx = buffer.indexOf(HEADER);
                        if (hIdx === -1) {
                            // No header found, keep only enough for potential next header part
                            if (buffer.length > 3) buffer = buffer.slice(buffer.length - 3);
                            break;
                        }
                        if (hIdx > 0) {
                            buffer = buffer.slice(hIdx); // Align to header
                            continue;
                        }

                        // We are at a header
                        const dataLen = buffer.readUInt16LE(4);
                        const totalFrameLen = 4 + 2 + dataLen + 4; // Header(4) + Len(2) + Data + Tail(4)

                        if (buffer.length < totalFrameLen) break; // Frame not yet complete

                        const frame = buffer.slice(0, totalFrameLen);
                        const tail = frame.slice(frame.length - 4);

                        if (tail.equals(TAIL)) {
                            parseFrame(frame.slice(4)); // Data part starts at byte 4 (Length)
                        }

                        buffer = buffer.slice(totalFrameLen);
                    }
                });

                stream.on('error', (sErr) => {
                    console.error("Presence: Serial Stream error", sErr.message);
                    setTimeout(startSerial, 5000); // Retry
                });
            });
        };

        // Presence Timeout Monitor
        setInterval(() => {
            const secondsSincePresence = (Date.now() - lastPresence) / 1000;
            if (secondsSincePresence > config.offDelay && displayPower) {
                setDisplay(false);
            }
        }, 5000);

        // Only start on Linux (RPi)
        if (process.platform === 'linux') {
            startSerial();
        } else {
            console.warn("Presence Backend: Not running on Linux. Interaction with hardware sensor disabled.");
        }

        // Status API for the frontend
        app.get('/api/presence/status', (req, res) => {
            res.json({
                present: isPersonPresent,
                lastPresence: lastPresence,
                displayOn: displayPower,
                secondsSincePresence: Math.floor((Date.now() - lastPresence) / 1000),
                config: {
                    offDelay: config.offDelay,
                    sensitivity: config.sensitivity
                }
            });
        });
    }
};
