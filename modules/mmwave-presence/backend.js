const { exec } = require('child_process');
let SerialPort = null;
let ReadlineParser = null;

// Try to load serialport (only available on Linux/RPi)
try {
    const serialport = require('serialport');
    SerialPort = serialport.SerialPort;
    ReadlineParser = serialport.ReadlineParser;
} catch (e) {
    console.warn('Presence Backend: serialport not available. Install with: npm install serialport');
}

/**
 * mmWave Presence Sensor Backend
 * 24GHz mmWave Sensor for XIAO (Seeed Studio)
 * Protocol: Serial UART @ 256000 baud (default)
 * Frame Format: Header (F4 F3 F2 F1) + Length + Data + Tail (F8 F7 F6 F5)
 */
module.exports = {
    registerRoutes: (app, context) => {
        let config = {
            port: '/dev/ttyAMA0',      // UART port (GPIO14/15)
            baudRate: 256000,          // Default baudrate (can be changed via command)
            sensitivity: 40,            // Motion/Static sensitivity (0-100)
            maxDistanceGate: 8,         // Maximum detection distance gate (1-8, each = 0.75m)
            offDelay: 60,               // Display off delay in seconds
            engineeringMode: false       // Enable engineering mode for detailed data
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
        let serialPort = null;
        let buffer = Buffer.alloc(0);

        // Protocol constants (from documentation)
        const FRAME_HEADER = Buffer.from([0xF4, 0xF3, 0xF2, 0xF1]);
        const FRAME_TAIL = Buffer.from([0xF8, 0xF7, 0xF6, 0xF5]);
        const DATA_HEADER = 0xAA;
        const DATA_TAIL = 0x55;
        const DATA_TYPE_BASIC = 0x02;      // Basic target info (normal mode)
        const DATA_TYPE_ENGINEERING = 0x01; // Engineering mode (with energy values)

        // Target status values (from Table 13)
        const TARGET_NONE = 0x00;
        const TARGET_MOVING = 0x01;
        const TARGET_STATIC = 0x02;
        const TARGET_BOTH = 0x03;

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
                    console.error("Presence: vcgencmd display_power failed", err.message);
                    exec(`export DISPLAY=:0 && xset dpms force ${power ? 'on' : 'off'}`, () => { });
                }
            });
        };

        /**
         * Send command to sensor (with ACK)
         * Protocol: Header (FD FC FB FA) + Length + Command + Tail (04 03 02 01)
         */
        const sendCommand = (commandWord, commandValue = null) => {
            if (!serialPort || !serialPort.isOpen) return;

            // Build command frame
            let dataLength = 2; // Command word (2 bytes)
            if (commandValue) {
                dataLength += commandValue.length;
            }

            const frame = Buffer.alloc(4 + 2 + dataLength + 4);
            let offset = 0;

            // Header
            frame.writeUInt32LE(0xFAFBFCFD, offset); // FD FC FB FA (little-endian)
            offset += 4;

            // Length
            frame.writeUInt16LE(dataLength, offset);
            offset += 2;

            // Command word
            frame.writeUInt16LE(commandWord, offset);
            offset += 2;

            // Command value (if any)
            if (commandValue) {
                commandValue.copy(frame, offset);
                offset += commandValue.length;
            }

            // Tail
            frame.writeUInt32LE(0x01020304, offset); // 04 03 02 01 (little-endian)

            serialPort.write(frame);
        };

        /**
         * Configure sensor sensitivity
         * Command 0x0064: Distance gate sensitivity configuration
         */
        const configureSensitivity = () => {
            console.log(`Presence: Configuring sensor sensitivity to ${config.sensitivity}%`);

            // 1. Enable configuration mode (Command 0x00FF)
            sendCommand(0x00FF, Buffer.from([0x01, 0x00]));

            setTimeout(() => {
                // 2. Set sensitivity for all distance gates (0xFFFF = all gates)
                // Parameter words: Distance gate (0x0000), Motion sensitivity (0x0001), Static sensitivity (0x0002)
                const sensitivityValue = config.sensitivity;
                const cmdValue = Buffer.alloc(14);
                let offset = 0;
                cmdValue.writeUInt16LE(0xFFFF, offset); offset += 2; // All distance gates
                cmdValue.writeUInt32LE(sensitivityValue, offset); offset += 4; // Motion sensitivity
                cmdValue.writeUInt16LE(0x0001, offset); offset += 2; // Motion sensitivity word
                cmdValue.writeUInt32LE(sensitivityValue, offset); offset += 4; // Static sensitivity
                cmdValue.writeUInt16LE(0x0002, offset); // Static sensitivity word

                sendCommand(0x0064, cmdValue);

                setTimeout(() => {
                    // 3. End configuration mode (Command 0x00FE)
                    sendCommand(0x00FE);
                    console.log('Presence: Sensor configuration completed');
                }, 200);
            }, 200);
        };

        /**
         * Parse radar data frame
         * Format: Header (F4 F3 F2 F1) + Length (2 bytes) + Data Type + Header (0xAA) + Target Data + Tail (0x55) + Calibration (0x00) + Frame Tail (F8 F7 F6 F5)
         */
        const parseFrame = (frameData) => {
            if (frameData.length < 10) return; // Minimum frame size

            // Skip frame header (4 bytes) and length (2 bytes) - already validated
            let offset = 6;

            // Data type (1 byte)
            const dataType = frameData[offset++];

            // Data header (should be 0xAA)
            if (frameData[offset++] !== DATA_HEADER) {
                console.warn('Presence: Invalid data header in frame');
                return;
            }

            // Parse based on data type
            if (dataType === DATA_TYPE_BASIC || dataType === DATA_TYPE_ENGINEERING) {
                // Target status (1 byte) - Table 13
                const targetStatus = frameData[offset++];

                // Motion target distance (2 bytes, little-endian, in cm)
                const motionDistance = frameData.readUInt16LE(offset);
                offset += 2;

                // Motion target energy value (1 byte)
                const motionEnergy = frameData[offset++];

                // Static target distance (2 bytes, little-endian, in cm)
                const staticDistance = frameData.readUInt16LE(offset);
                offset += 2;

                // Static target energy value (1 byte)
                const staticEnergy = frameData[offset++];

                // Detection distance (2 bytes, little-endian, in cm)
                const detectionDistance = frameData.readUInt16LE(offset);
                offset += 2;

                // Check target status
                if (targetStatus === TARGET_MOVING || targetStatus === TARGET_STATIC || targetStatus === TARGET_BOTH) {
                    lastPresence = Date.now();
                    if (!isPersonPresent) {
                        isPersonPresent = true;
                        console.log(`Presence: Person detected (Status: ${targetStatus}, Motion: ${motionDistance}cm, Static: ${staticDistance}cm)`);
                        setDisplay(true);
                    }
                } else if (targetStatus === TARGET_NONE) {
                    if (isPersonPresent) {
                        isPersonPresent = false;
                        console.log('Presence: No target detected');
                    }
                }
            }
        };

        /**
         * Process incoming serial data
         */
        const processData = (data) => {
            buffer = Buffer.concat([buffer, data]);

            // Process buffer for complete frames
            while (buffer.length >= 10) {
                // Find frame header
                const headerIdx = buffer.indexOf(FRAME_HEADER);
                if (headerIdx === -1) {
                    // No header found, keep only last 3 bytes (potential header start)
                    if (buffer.length > 3) {
                        buffer = buffer.slice(buffer.length - 3);
                    } else {
                        buffer = Buffer.alloc(0);
                    }
                    break;
                }

                // Remove data before header
                if (headerIdx > 0) {
                    buffer = buffer.slice(headerIdx);
                    continue;
                }

                // Check if we have enough data for length field
                if (buffer.length < 6) break;

                // Read data length (2 bytes, little-endian)
                const dataLength = buffer.readUInt16LE(4);
                const totalFrameLength = 4 + 2 + dataLength + 4; // Header + Length + Data + Tail

                // Check if complete frame is available
                if (buffer.length < totalFrameLength) break;

                // Extract frame
                const frame = buffer.slice(0, totalFrameLength);
                const tail = frame.slice(totalFrameLength - 4);

                // Validate frame tail
                if (tail.equals(FRAME_TAIL)) {
                    parseFrame(frame);
                } else {
                    console.warn('Presence: Invalid frame tail');
                }

                // Remove processed frame from buffer
                buffer = buffer.slice(totalFrameLength);
            }
        };

        /**
         * Start serial communication
         */
        const startSerial = () => {
            if (!SerialPort) {
                console.error('Presence: serialport library not available. Install with: npm install serialport');
                return;
            }

            if (process.platform !== 'linux') {
                console.warn('Presence Backend: Not running on Linux. Hardware sensor disabled.');
                return;
            }

            console.log(`Presence: Opening sensor on ${config.port} at ${config.baudRate} baud...`);

            try {
                serialPort = new SerialPort({
                    path: config.port,
                    baudRate: config.baudRate,
                    dataBits: 8,
                    stopBits: 1,
                    parity: 'none'
                });

                serialPort.on('open', () => {
                    console.log(`Presence: Serial port ${config.port} opened successfully`);
                    buffer = Buffer.alloc(0);

                    // Configure sensor after connection
                    setTimeout(() => {
                        configureSensitivity();
                    }, 1000);
                });

                serialPort.on('data', (data) => {
                    processData(data);
                });

                serialPort.on('error', (err) => {
                    console.error(`Presence: Serial port error: ${err.message}`);
                    setTimeout(() => {
                        if (serialPort && serialPort.isOpen) {
                            serialPort.close();
                        }
                        startSerial(); // Retry
                    }, 5000);
                });

                serialPort.on('close', () => {
                    console.log('Presence: Serial port closed');
                    setTimeout(() => {
                        startSerial(); // Reconnect
                    }, 5000);
                });

            } catch (err) {
                console.error(`Presence: Failed to open serial port ${config.port}:`, err.message);
                setTimeout(() => startSerial(), 5000); // Retry
            }
        };

        // Presence Timeout Monitor (turn off display after offDelay seconds of no presence)
        setInterval(() => {
            const secondsSincePresence = (Date.now() - lastPresence) / 1000;
            if (secondsSincePresence > config.offDelay && displayPower) {
                setDisplay(false);
            }
        }, 5000);

        // Start serial communication
        if (process.platform === 'linux') {
            startSerial();
        }

        // Status API for the frontend
        app.get('/api/presence/status', (req, res) => {
            res.json({
                present: isPersonPresent,
                lastPresence: lastPresence,
                displayOn: displayPower,
                secondsSincePresence: Math.floor((Date.now() - lastPresence) / 1000),
                port: config.port,
                baudRate: config.baudRate,
                config: {
                    offDelay: config.offDelay,
                    sensitivity: config.sensitivity,
                    maxDistanceGate: config.maxDistanceGate
                }
            });
        });

        // Manual trigger API (for testing)
        app.post('/api/presence/trigger', (req, res) => {
            lastPresence = Date.now();
            isPersonPresent = true;
            setDisplay(true);
            res.json({ success: true, message: 'Presence triggered manually' });
        });

        // Cleanup on exit
        process.on('SIGINT', () => {
            if (serialPort && serialPort.isOpen) {
                serialPort.close();
            }
        });
    }
};
