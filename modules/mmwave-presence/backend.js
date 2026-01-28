const { exec } = require('child_process');
const fs = require('fs');
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

// Debug logging
let debugLog = [];
const MAX_DEBUG_LOG = 100;
const addDebugLog = (level, message, data = null) => {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        data
    };
    debugLog.push(entry);
    if (debugLog.length > MAX_DEBUG_LOG) {
        debugLog.shift();
    }
    console.log(`[Presence ${level}] ${message}`, data || '');
};

/**
 * mmWave Presence Sensor Backend
 * 24GHz mmWave Sensor for XIAO (Seeed Studio)
 * Protocol: Serial UART @ 256000 baud (default)
 * Frame Format: Header (F4 F3 F2 F1) + Length + Data + Tail (F8 F7 F6 F5)
 */
module.exports = {
    registerRoutes: (app, context) => {
        let config = {
            port: '/dev/ttyAMA0',      // UART port (GPIO14/15) - will auto-detect ttyAMA1 if needed
            baudRate: 256000,          // Default baudrate (can be changed via command)
            sensitivity: 40,            // Motion/Static sensitivity (0-100)
            maxDistanceGate: 8,         // Maximum detection distance gate (1-8, each = 0.75m)
            offDelay: 60,               // Display off delay in seconds
            engineeringMode: false       // Enable engineering mode for detailed data
        };

        // Load config from context if possible
        let moduleEnabled = false;
        try {
            if (context && context.ConfigManager) {
                const configManager = new context.ConfigManager(context.instanceName);
                const fullConfig = configManager.loadConfig();
                const moduleConfig = fullConfig.modules.find(m => m.name === 'mmwave-presence');
                
                // Check if module is enabled in config
                if (moduleConfig) {
                    moduleEnabled = true;
                    if (moduleConfig.config) {
                        config = { ...config, ...moduleConfig.config };
                    }
                } else {
                    // Module not in config - ensure display is ON and exit
                    addDebugLog('INFO', 'Module not found in config, ensuring display is ON');
                    if (process.platform === 'linux') {
                        exec('vcgencmd display_power 1', (err) => {
                            if (err) {
                                addDebugLog('WARN', 'Could not turn display on via vcgencmd');
                            } else {
                                addDebugLog('INFO', 'Display turned ON (module disabled)');
                            }
                        });
                    }
                    return; // Don't start backend if module is not in config
                }
            }
        } catch (e) {
            console.error("Presence Backend: Error loading config", e);
            // If config loading fails, assume module should run (backward compatibility)
            moduleEnabled = true;
        }

        let lastPresence = Date.now();
        let isPersonPresent = false;
        let displayPower = true;
        let serialPort = null;
        let buffer = Buffer.alloc(0);
        let connectionStatus = 'disconnected';
        let lastError = null;
        let bytesReceived = 0;
        let framesReceived = 0;

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
                    framesReceived++;
                    addDebugLog('DEBUG', `Valid frame received (${framesReceived} total)`, frame.slice(0, 20).toString('hex'));
                    parseFrame(frame);
                } else {
                    addDebugLog('WARN', 'Invalid frame tail', { expected: FRAME_TAIL.toString('hex'), got: tail.toString('hex') });
                }

                // Remove processed frame from buffer
                buffer = buffer.slice(totalFrameLength);
            }
        };

        /**
         * Find available serial ports
         */
        const findAvailablePorts = (callback) => {
            if (!SerialPort) {
                callback([]);
                return;
            }

            SerialPort.list().then((ports) => {
                const availablePorts = ports
                    .filter(port => port.path.startsWith('/dev/tty'))
                    .map(port => ({
                        path: port.path,
                        manufacturer: port.manufacturer || 'Unknown',
                        pnpId: port.pnpId || ''
                    }));
                callback(availablePorts);
            }).catch((err) => {
                addDebugLog('ERROR', 'Failed to list serial ports', err.message);
                callback([]);
            });
        };

        /**
         * Check if port exists
         */
        const checkPortExists = (portPath) => {
            try {
                return fs.existsSync(portPath);
            } catch (e) {
                return false;
            }
        };

        /**
         * Start serial communication
         */
        const startSerial = () => {
            if (!SerialPort) {
                addDebugLog('ERROR', 'serialport library not available. Install with: npm install serialport');
                connectionStatus = 'error';
                lastError = 'serialport library not installed';
                return;
            }

            if (process.platform !== 'linux') {
                addDebugLog('WARN', 'Not running on Linux. Hardware sensor disabled.');
                connectionStatus = 'disabled';
                return;
            }

            // Check if port exists, try alternatives if not
            if (!checkPortExists(config.port)) {
                addDebugLog('WARN', `Serial port ${config.port} does not exist, trying alternatives...`);
                
                // Try common alternatives
                const alternatives = ['/dev/ttyAMA1', '/dev/ttyS0', '/dev/ttyUSB0'];
                let foundAlternative = false;
                
                for (const altPort of alternatives) {
                    if (checkPortExists(altPort)) {
                        addDebugLog('INFO', `Found alternative port: ${altPort}, using it instead`);
                        config.port = altPort;
                        foundAlternative = true;
                        break;
                    }
                }
                
                if (!foundAlternative) {
                    connectionStatus = 'error';
                    lastError = `Port ${config.port} not found and no alternatives available`;
                    
                    // Check kernel command line for UART disable
                    const kernelCmdline = fs.readFileSync('/proc/cmdline', 'utf8');
                    const uartDisabled = kernelCmdline.includes('8250.nr_uarts=0');
                    
                    // Try to find any available ports
                    findAvailablePorts((ports) => {
                        if (ports.length > 0) {
                            addDebugLog('INFO', `Found ${ports.length} available serial port(s):`, ports.map(p => p.path).join(', '));
                            addDebugLog('INFO', `Try setting config.port to: ${ports[0].path}`);
                            lastError = `Port ${config.port} not found. Available: ${ports.map(p => p.path).join(', ')}`;
                        } else {
                            addDebugLog('ERROR', 'No serial ports found. UART is disabled.');
                            if (uartDisabled) {
                                addDebugLog('INFO', 'UART is disabled in kernel (8250.nr_uarts=0)');
                                addDebugLog('INFO', 'To enable UART for mmWave sensor:');
                                addDebugLog('INFO', '1. Edit: sudo nano /boot/firmware/cmdline.txt');
                                addDebugLog('INFO', '2. Remove "8250.nr_uarts=0" from the line');
                                addDebugLog('INFO', '3. Add to /boot/firmware/config.txt: enable_uart=1');
                                addDebugLog('INFO', '4. Reboot: sudo reboot');
                                lastError = 'UART disabled (8250.nr_uarts=0). See debug log for instructions.';
                            } else {
                                addDebugLog('INFO', 'Enable UART: sudo raspi-config -> Interface Options -> Serial Port');
                                addDebugLog('INFO', 'Or add to /boot/firmware/config.txt: enable_uart=1');
                            }
                        }
                    });
                    
                    setTimeout(() => startSerial(), 10000); // Retry after 10 seconds
                    return;
                }
            }

            addDebugLog('INFO', `Attempting to open ${config.port} at ${config.baudRate} baud`);
            connectionStatus = 'connecting';
            lastError = null;

            try {
                serialPort = new SerialPort({
                    path: config.port,
                    baudRate: config.baudRate,
                    dataBits: 8,
                    stopBits: 1,
                    parity: 'none',
                    autoOpen: false
                });

                serialPort.on('open', () => {
                    addDebugLog('SUCCESS', `Serial port ${config.port} opened successfully`);
                    connectionStatus = 'connected';
                    lastError = null;
                    buffer = Buffer.alloc(0);
                    bytesReceived = 0;
                    framesReceived = 0;

                    // Configure sensor after connection
                    setTimeout(() => {
                        configureSensitivity();
                    }, 1000);
                });

                serialPort.on('data', (data) => {
                    bytesReceived += data.length;
                    addDebugLog('DEBUG', `Received ${data.length} bytes (total: ${bytesReceived})`, data.slice(0, 16).toString('hex'));
                    processData(data);
                });

                serialPort.on('error', (err) => {
                    addDebugLog('ERROR', `Serial port error: ${err.message}`, err);
                    connectionStatus = 'error';
                    lastError = err.message;
                    setTimeout(() => {
                        if (serialPort && serialPort.isOpen) {
                            serialPort.close();
                        }
                        startSerial(); // Retry
                    }, 5000);
                });

                serialPort.on('close', () => {
                    addDebugLog('WARN', 'Serial port closed');
                    connectionStatus = 'disconnected';
                    setTimeout(() => {
                        startSerial(); // Reconnect
                    }, 5000);
                });

                // Open the port
                serialPort.open((err) => {
                    if (err) {
                        addDebugLog('ERROR', `Failed to open serial port: ${err.message}`, err);
                        connectionStatus = 'error';
                        lastError = err.message;
                        setTimeout(() => startSerial(), 5000);
                    }
                });

            } catch (err) {
                addDebugLog('ERROR', `Failed to create serial port: ${err.message}`, err);
                connectionStatus = 'error';
                lastError = err.message;
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
                connectionStatus: connectionStatus,
                port: config.port,
                portExists: checkPortExists(config.port),
                baudRate: config.baudRate,
                isConnected: serialPort && serialPort.isOpen,
                bytesReceived: bytesReceived,
                framesReceived: framesReceived,
                lastError: lastError,
                config: {
                    offDelay: config.offDelay,
                    sensitivity: config.sensitivity,
                    maxDistanceGate: config.maxDistanceGate
                }
            });
        });

        // Debug API - returns detailed debug log
        app.get('/api/presence/debug', (req, res) => {
            findAvailablePorts((ports) => {
                // Check kernel config
                let kernelCmdline = '';
                let uartDisabled = false;
                try {
                    kernelCmdline = fs.readFileSync('/proc/cmdline', 'utf8');
                    uartDisabled = kernelCmdline.includes('8250.nr_uarts=0');
                } catch (e) {
                    // Ignore
                }

                // Check boot config
                let bootConfigExists = false;
                let bootConfigContent = '';
                try {
                    const bootConfigPath = '/boot/firmware/config.txt';
                    if (fs.existsSync(bootConfigPath)) {
                        bootConfigExists = true;
                        bootConfigContent = fs.readFileSync(bootConfigPath, 'utf8');
                    }
                } catch (e) {
                    // Ignore
                }

                res.json({
                    debugLog: debugLog.slice(-50), // Last 50 entries
                    connectionStatus: connectionStatus,
                    port: config.port,
                    portExists: checkPortExists(config.port),
                    availablePorts: ports,
                    serialportInstalled: SerialPort !== null,
                    platform: process.platform,
                    bytesReceived: bytesReceived,
                    framesReceived: framesReceived,
                    bufferSize: buffer.length,
                    lastError: lastError,
                    systemInfo: {
                        kernelCmdline: kernelCmdline.trim(),
                        uartDisabled: uartDisabled,
                        bootConfigExists: bootConfigExists,
                        enableUartInConfig: bootConfigContent.includes('enable_uart=1'),
                        instructions: uartDisabled ? [
                            'UART is disabled in kernel (8250.nr_uarts=0)',
                            'To enable:',
                            '1. sudo nano /boot/firmware/cmdline.txt',
                            '2. Remove "8250.nr_uarts=0"',
                            '3. sudo nano /boot/firmware/config.txt',
                            '4. Add: enable_uart=1',
                            '5. sudo reboot'
                        ] : []
                    }
                });
            });
        });

        // Manual trigger API (for testing)
        app.post('/api/presence/trigger', (req, res) => {
            lastPresence = Date.now();
            isPersonPresent = true;
            setDisplay(true);
            res.json({ success: true, message: 'Presence triggered manually' });
        });

        // Disable presence detection API (turns display back on and stops monitoring)
        app.post('/api/presence/disable', (req, res) => {
            addDebugLog('INFO', 'Presence detection disabled by API request');
            
            // Turn display back on
            setDisplay(true);
            
            // Close serial port if open
            if (serialPort && serialPort.isOpen) {
                serialPort.close();
            }
            
            // Stop monitoring
            connectionStatus = 'disabled';
            
            res.json({ success: true, message: 'Presence detection disabled, display turned on' });
        });

        // Force display ON API (useful when module is removed)
        app.post('/api/presence/display-on', (req, res) => {
            addDebugLog('INFO', 'Display forced ON by API request');
            setDisplay(true);
            res.json({ success: true, message: 'Display turned on' });
        });

        // Cleanup function - ensures display is turned on when module stops
        const cleanup = () => {
            addDebugLog('INFO', 'Cleaning up presence module...');
            
            // Always turn display back on when module stops
            if (!displayPower) {
                addDebugLog('INFO', 'Turning display back ON before module shutdown');
                displayPower = false; // Reset flag so setDisplay actually turns it on
                setDisplay(true);
            }
            
            // Close serial port
            if (serialPort && serialPort.isOpen) {
                serialPort.close();
            }
        };

        // Cleanup on various exit signals
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
        
        // Also cleanup on uncaught exceptions
        process.on('uncaughtException', (err) => {
            addDebugLog('ERROR', 'Uncaught exception', err.message);
            cleanup();
        });
    }
};
