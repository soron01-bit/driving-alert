// Import MediaPipe Tasks Vision from jsDelivr ESM CDN
const { FaceLandmarker, FilesetResolver } = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
);

// Constants for Eye Aspect Ratio (EAR) calculations
const RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

const LEFT_EYE_CONTOUR = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const RIGHT_EYE_CONTOUR = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];

// System States
let engineState = "RUNNING"; // "RUNNING" or "STOPPED"
let alarmState = "IDLE";     // "IDLE" or "TRIGGERED"
let eyesClosedStartTime = null;
let alarmStartTime = null;

// MediaPipe & Webcam Variables
let faceLandmarker = null;
let webcamStream = null;
let lastVideoTime = -1;

// --- 2D First-Person Car Driving Simulator State Variables ---
const gameCanvas = document.getElementById("game-canvas");
const gameCtx = gameCanvas.getContext("2d");

// Driving Simulator is programmatically drawn
let dashboardLoaded = true; // Instantly ready

// Physics Variables
let playerX = 430; // Center lane initially
let speed = 0;
let targetSpeed = 0;
const maxSpeed = 8;

let keys = {};
let obstacles = [];
let roadY = 0;
let score = 0;
let highScore = 0;
let lastObstacleTime = 0;
let flashRedFrames = 0;

// Upgraded Graphics & Game States
let boostActive = false;
let screenShake = 0;
let particles = [];
let currentEar = null;
let itemPickups = []; // plus/health pickup items
let lastItemTime = 0;
let wheelAngle = 0; // steering wheel rotation angle

// Image Assets & Selection
let carImages = {
    car1: null,
    car2: null,
    car3: null
};
let roadImage = null;
let natureImage = null;
let activePlayerCarKey = "car1";
let scrollOffset = 0;

// Track high score in local storage
if (localStorage.getItem("drowsy_high_score")) {
    highScore = parseInt(localStorage.getItem("drowsy_high_score"), 10);
}

// Bind Keyboard Listeners for steering controls
window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
});
window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
});

// Web Audio API Synthesizer Class
class AlarmWebManager {
    constructor() {
        this.audioCtx = null;
        this.isPlaying = false;
        this.intervalId = null;
        this.timeoutId = null;
    }

    init() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    play(durationSeconds) {
        this.init();
        if (this.isPlaying) return;
        this.isPlaying = true;

        // Pulse warning sounds: 1200Hz frequency, 120ms beep / 80ms silence
        const pulse = () => {
            if (!this.isPlaying) return;
            try {
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(1200, this.audioCtx.currentTime);

                gain.gain.setValueAtTime(0.25, this.audioCtx.currentTime);
                // Prevent clicking audio anomalies by ramping volume down at the beep end
                gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.115);

                osc.connect(gain);
                gain.connect(this.audioCtx.destination);

                osc.start();
                osc.stop(this.audioCtx.currentTime + 0.12);
            } catch (e) {
                console.error("Synthesizer audio playback failed: ", e);
            }
        };

        pulse();
        this.intervalId = setInterval(pulse, 200);

        // Auto-stop alarm timer
        this.timeoutId = setTimeout(() => {
            this.stop();
        }, durationSeconds * 1000);
    }

    stop() {
        if (!this.isPlaying) return;
        this.isPlaying = false;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
}

const alarmWebManager = new AlarmWebManager();

// DOM Element Selectors
const loadingScreen = document.getElementById("loading-screen");
const webcamElement = document.getElementById("webcam");
const canvasElement = document.getElementById("output-canvas");
const canvasCtx = canvasElement.getContext("2d");
const cameraError = document.getElementById("camera-error");

const ignitionBtn = document.getElementById("ignition-btn");
const engineStatusText = document.getElementById("engine-status-text");
const engineStatusDesc = document.getElementById("engine-status-desc");

const earDisplay = document.getElementById("ear-display");
const timerDisplay = document.getElementById("timer-display");
const progressBar = document.getElementById("progress-bar");

const earThresholdInput = document.getElementById("ear-threshold");
const triggerDelayInput = document.getElementById("trigger-delay");
const alarmDurationInput = document.getElementById("alarm-duration");

const earThresholdVal = document.getElementById("ear-threshold-val");
const triggerDelayVal = document.getElementById("trigger-delay-val");
const alarmDurationVal = document.getElementById("alarm-duration-val");

// Slider Value Label Updates
earThresholdInput.addEventListener("input", (e) => {
    earThresholdVal.textContent = parseFloat(e.target.value).toFixed(2);
});
triggerDelayInput.addEventListener("input", (e) => {
    triggerDelayVal.textContent = parseFloat(e.target.value).toFixed(1) + "s";
});
alarmDurationInput.addEventListener("input", (e) => {
    alarmDurationVal.textContent = parseFloat(e.target.value).toFixed(1) + "s";
});

// Setup Engine Controls
ignitionBtn.addEventListener("click", () => {
    // Unlock Audio Context on User Action to satisfy browser requirements
    alarmWebManager.init();

    if (engineState === "RUNNING") {
        stopEngine("MANUAL SHUTDOWN");
    } else {
        startEngine("MANUAL IGNITION");
    }
});

function startEngine(source = "MANUAL IGNITION") {
    if (engineState !== "RUNNING") {
        engineState = "RUNNING";
        alarmWebManager.stop();
        alarmState = "IDLE";
        alarmStartTime = null;

        // Reset game state for a fresh start
        playerX = 430;
        score = 0;
        obstacles = [];
        itemPickups = [];
        particles = [];
        speed = 0;

        ignitionBtn.className = "engine-btn running";
        engineStatusText.textContent = "ENGINE ACTIVE";
        engineStatusText.className = "status-title running";
        engineStatusDesc.textContent = `Engine restarted via ${source}.`;
        engineStatusDesc.className = "status-desc";
    }
}

function stopEngine(reason = "DROWSINESS DETECTED") {
    if (engineState !== "STOPPED") {
        engineState = "STOPPED";

        ignitionBtn.className = "engine-btn stopped";
        engineStatusText.textContent = "ENGINE STOPPED";
        engineStatusText.className = "status-title stopped";
        if (reason === "DROWSINESS DETECTED") {
            engineStatusDesc.textContent = "Autopilot parking engaged. Press START manually.";
        } else {
            engineStatusDesc.textContent = `Kill-switch engaged: ${reason}!`;
        }
        engineStatusDesc.className = "status-desc danger";
    }
}

// Distance & Eye Aspect Ratio Helpers
function getDistance(pt1, pt2, width, height) {
    const dx = (pt1.x - pt2.x) * width;
    const dy = (pt1.y - pt2.y) * height;
    return Math.sqrt(dx * dx + dy * dy);
}

function calculateEar(landmarks, indices, width, height) {
    const d_v1 = getDistance(landmarks[indices[1]], landmarks[indices[5]], width, height); // p2 - p6
    const d_v2 = getDistance(landmarks[indices[2]], landmarks[indices[4]], width, height); // p3 - p5
    const d_h = getDistance(landmarks[indices[0]], landmarks[indices[3]], width, height);   // p1 - p4

    if (d_h === 0) return 0.0;
    return (d_v1 + d_v2) / (2.0 * d_h);
}

function drawContour(ctx, landmarks, indices, width, height, color) {
    ctx.beginPath();
    for (let i = 0; i < indices.length; i++) {
        const pt = landmarks[indices[i]];
        const x = pt.x * width;
        const y = pt.y * height;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

// Core Safety State Machine Loop
function runSafetyLogic(avgEar, faceDetected) {
    const currentTime = performance.now();
    const threshold = parseFloat(earThresholdInput.value);
    const delay = parseFloat(triggerDelayInput.value);
    const duration = parseFloat(alarmDurationInput.value);

    if (faceDetected && avgEar !== null) {
        earDisplay.textContent = avgEar.toFixed(3);

        if (avgEar < threshold) {
            // Driver eyes are closed!
            if (eyesClosedStartTime === null) {
                eyesClosedStartTime = currentTime;
            }
            const closedDuration = (currentTime - eyesClosedStartTime) / 1000;
            timerDisplay.textContent = closedDuration.toFixed(1) + "s";
            timerDisplay.style.color = "var(--color-red)";

            // Update Progress Bar
            const percentage = Math.min((closedDuration / delay) * 100, 100);
            progressBar.style.width = percentage + "%";
            if (percentage > 80) {
                progressBar.style.backgroundColor = "var(--color-red)";
            } else if (percentage > 40) {
                progressBar.style.backgroundColor = "#f59e0b"; // Orange
            } else {
                progressBar.style.backgroundColor = "var(--color-green)";
            }

            // Check if Closed Duration triggers alarm
            if (closedDuration >= delay) {
                if (engineState === "RUNNING" && alarmState === "IDLE") {
                    alarmWebManager.play(duration);
                    alarmState = "TRIGGERED";
                    alarmStartTime = currentTime;
                    stopEngine("DROWSINESS DETECTED");
                }
            }
        } else {
            // Driver eyes are open!
            eyesClosedStartTime = null;
            timerDisplay.textContent = "0.0s";
            timerDisplay.style.color = "var(--text-color)";
            progressBar.style.width = "0%";
            progressBar.style.backgroundColor = "var(--color-green)";

            // Cancel alarm siren immediately upon eyes opening
            if (alarmState === "TRIGGERED") {
                alarmWebManager.stop();
                alarmState = "IDLE";
                alarmStartTime = null;
            }
            // Engine remains stopped. Driver must click button manually to restart.
        }
    } else {
        // No driver face detected
        earDisplay.textContent = "---";
        timerDisplay.textContent = "---";
        timerDisplay.style.color = "var(--text-muted)";
        progressBar.style.width = "0%";
        eyesClosedStartTime = null;
    }

    // Auto-timeout for Siren duration if driver does not open eyes
    if (alarmState === "TRIGGERED" && alarmStartTime !== null) {
        const playedDuration = (currentTime - alarmStartTime) / 1000;
        if (playedDuration >= duration) {
            alarmState = "IDLE";
            alarmStartTime = null;
        }
    }
}

// Camera Frame Rendering Loop (Sidebar Panel)
async function predictLoop() {
    const width = canvasElement.width;
    const height = canvasElement.height;

    if (webcamElement.currentTime !== lastVideoTime) {
        lastVideoTime = webcamElement.currentTime;

        // Clear canvas and draw mirrored camera video frame
        canvasCtx.save();
        canvasCtx.translate(width, 0);
        canvasCtx.scale(-1, 1);
        canvasCtx.drawImage(webcamElement, 0, 0, width, height);

        // Detect landmarks
        let avgEar = null;
        let faceDetected = false;
        const results = faceLandmarker.detectForVideo(webcamElement, performance.now());

        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            faceDetected = true;
            const landmarks = results.faceLandmarks[0];

            // Calculate EAR
            const rightEar = calculateEar(landmarks, RIGHT_EYE_INDICES, width, height);
            const leftEar = calculateEar(landmarks, LEFT_EYE_INDICES, width, height);
            avgEar = (rightEar + leftEar) / 2.0;
            currentEar = avgEar;

            // Draw eye contours on canvas overlay (already mirrored due to canvas translate/scale)
            drawContour(canvasCtx, landmarks, LEFT_EYE_CONTOUR, width, height, "cyan");
            drawContour(canvasCtx, landmarks, RIGHT_EYE_CONTOUR, width, height, "cyan");

            // Draw key index dots
            canvasCtx.fillStyle = "red";
            const keyPoints = [...LEFT_EYE_INDICES, ...RIGHT_EYE_INDICES];
            for (let idx of keyPoints) {
                const pt = landmarks[idx];
                canvasCtx.beginPath();
                canvasCtx.arc(pt.x * width, pt.y * height, 2, 0, 2 * Math.PI);
                canvasCtx.fill();
            }
        } else {
            currentEar = null;
        }

        canvasCtx.restore();

        // Run decision state machine
        runSafetyLogic(avgEar, faceDetected);
    }

    requestAnimationFrame(predictLoop);
}

// --- 2D First-Person Driving Simulator Mechanics ---

function getRandomColor() {
    const colors = ["#ef4444", "#f59e0b", "#3b82f6", "#a855f7", "#ec4899", "#10b981"];
    return colors[Math.floor(Math.random() * colors.length)];
}

function loadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => {
            console.warn(`Failed to load image asset: ${src}`);
            resolve(null);
        };
        img.src = src;
    });
}

function getObstacleCarKey() {
    const obstacleKeys = ["car1", "car2", "car3"].filter(k => k !== activePlayerCarKey);
    return obstacleKeys[Math.floor(Math.random() * obstacleKeys.length)];
}

function drawCarImage(ctx, cx, cy, img, fallbackColor, isPlayer = false) {
    if (img && img.complete && img.naturalWidth !== 0) {
        ctx.save();
        
        // Draw Headlight glowing beams if engine is running
        if (engineState === "RUNNING") {
            const w = 44;
            const h = 76;
            const lightGlow = ctx.createLinearGradient(cx, cy - h * 0.45, cx, cy - h * 0.9);
            lightGlow.addColorStop(0, "rgba(56, 189, 248, 0.5)");
            lightGlow.addColorStop(1, "rgba(56, 189, 248, 0)");
            ctx.fillStyle = lightGlow;
            ctx.beginPath();
            ctx.moveTo(cx - w * 0.35, cy - h * 0.45);
            ctx.lineTo(cx - w * 0.65, cy - h * 0.95);
            ctx.lineTo(cx - w * 0.05, cy - h * 0.95);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(cx + w * 0.05, cy - h * 0.45);
            ctx.lineTo(cx + w * 0.05, cy - h * 0.95);
            ctx.lineTo(cx + w * 0.65, cy - h * 0.95);
            ctx.closePath();
            ctx.fill();
        }

        // Draw the physical car image centered
        ctx.drawImage(img, cx - 22, cy - 38, 44, 76);

        // Draw exhaust flames if running and moving
        if (engineState === "RUNNING" && speed > 1) {
            const w = 44;
            const h = 76;
            const flameColor = Math.random() > 0.5 ? "#f43f5e" : "#ff7849";
            ctx.fillStyle = flameColor;
            ctx.beginPath();
            ctx.arc(cx - w * 0.22, cy + h * 0.46, 3 * (0.8 + Math.random() * 0.4), 0, Math.PI * 2);
            ctx.arc(cx + w * 0.22, cy + h * 0.46, 3 * (0.8 + Math.random() * 0.4), 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    } else {
        // Fallback to original vector drawing if image didn't load
        drawTopDownCar(ctx, cx, cy, fallbackColor, isPlayer);
    }
}

// // Draw top-down car vector representation matching reference layout
function drawTopDownCar(ctx, cx, cy, color, isPlayer) {
    ctx.save();
    
    const w = 44;
    const h = 76;
    
    // 1. Draw Wheels (4 wheels at corners)
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(cx - w * 0.52, cy - h * 0.35, w * 0.12, h * 0.22); // Front-left
    ctx.fillRect(cx + w * 0.40, cy - h * 0.35, w * 0.12, h * 0.22); // Front-right
    ctx.fillRect(cx - w * 0.52, cy + h * 0.15, w * 0.12, h * 0.22); // Rear-left
    ctx.fillRect(cx + w * 0.40, cy + h * 0.15, w * 0.12, h * 0.22); // Rear-right

    // 2. Main Body Shell with rounded corners
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(cx - w * 0.45, cy - h * 0.45, w * 0.9, h * 0.9, w * 0.25);
    ctx.fill();

    // 3. Side Mirrors
    ctx.fillStyle = color;
    ctx.fillRect(cx - w * 0.55, cy - h * 0.2, w * 0.1, h * 0.08); // Left mirror
    ctx.fillRect(cx + w * 0.45, cy - h * 0.2, w * 0.1, h * 0.08); // Right mirror

    // 4. Cockpit Windshield (Black glass)
    ctx.fillStyle = "#090d16";
    ctx.beginPath();
    ctx.roundRect(cx - w * 0.35, cy - h * 0.25, w * 0.7, h * 0.45, w * 0.15);
    ctx.fill();

    // 5. Roof Panel (body color covering middle of cockpit)
    ctx.fillStyle = color;
    ctx.fillRect(cx - w * 0.30, cy - h * 0.12, w * 0.6, h * 0.25);

    // 6. Front Windshield Glass highlight (glossy cyan reflection)
    ctx.fillStyle = "rgba(56, 189, 248, 0.45)";
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.3, cy - h * 0.2);
    ctx.lineTo(cx + w * 0.3, cy - h * 0.2);
    ctx.lineTo(cx + w * 0.2, cy - h * 0.12);
    ctx.lineTo(cx - w * 0.2, cy - h * 0.12);
    ctx.closePath();
    ctx.fill();

    // 7. Rear Windshield Glass highlight
    ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
    ctx.beginPath();
    ctx.roundRect(cx - w * 0.28, cy + h * 0.15, w * 0.56, h * 0.05, 1);
    ctx.fill();

    // 8. Front hood lines details
    ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.2, cy - h * 0.4);
    ctx.lineTo(cx - w * 0.2, cy - h * 0.28);
    ctx.moveTo(cx + w * 0.2, cy - h * 0.4);
    ctx.lineTo(cx + w * 0.2, cy - h * 0.28);
    ctx.stroke();

    // 9. Headlight glowing beams (cyan/blue neon)
    const lightGlow = ctx.createLinearGradient(cx, cy - h * 0.45, cx, cy - h * 0.9);
    lightGlow.addColorStop(0, "rgba(56, 189, 248, 0.65)");
    lightGlow.addColorStop(1, "rgba(56, 189, 248, 0)");
    ctx.fillStyle = lightGlow;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.35, cy - h * 0.45);
    ctx.lineTo(cx - w * 0.65, cy - h * 0.95);
    ctx.lineTo(cx - w * 0.05, cy - h * 0.95);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + w * 0.05, cy - h * 0.45);
    ctx.lineTo(cx + w * 0.05, cy - h * 0.95);
    ctx.lineTo(cx + w * 0.65, cy - h * 0.95);
    ctx.closePath();
    ctx.fill();

    // Headlight physical bulbs
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx - w * 0.36, cy - h * 0.45, w * 0.12, h * 0.04);
    ctx.fillRect(cx + w * 0.24, cy - h * 0.45, w * 0.12, h * 0.04);

    // 10. Rear Spoiler (Wing)
    ctx.fillStyle = "#090d16";
    ctx.fillRect(cx - w * 0.48, cy + h * 0.38, w * 0.96, h * 0.08); // Wing plate
    // Spoiler Mounts
    ctx.fillStyle = color;
    ctx.fillRect(cx - w * 0.35, cy + h * 0.33, w * 0.08, h * 0.06);
    ctx.fillRect(cx + w * 0.27, cy + h * 0.33, w * 0.08, h * 0.06);

    // Red Tail Lights (LED bar)
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(cx - w * 0.42, cy + h * 0.36, w * 0.15, h * 0.03);
    ctx.fillRect(cx + w * 0.27, cy + h * 0.36, w * 0.15, h * 0.03);

    // Exhaust flames
    if (speed > 1) {
        const flameColor = Math.random() > 0.5 ? "#f43f5e" : "#ff7849";
        ctx.fillStyle = flameColor;
        ctx.beginPath();
        ctx.arc(cx - w * 0.22, cy + h * 0.46, 3 * (0.8 + Math.random() * 0.4), 0, Math.PI * 2);
        ctx.arc(cx + w * 0.22, cy + h * 0.46, 3 * (0.8 + Math.random() * 0.4), 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawSteeringWheel(ctx, cx, cy, angle) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Outer rim glow
    ctx.shadowColor = "#38bdf8";
    ctx.shadowBlur = 10;

    // 1. Outer rim
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;

    // 2. Spokes (3-spoke design)
    ctx.fillStyle = "#1e293b";
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;

    // Left spoke
    ctx.beginPath();
    ctx.rect(-44, -4, 26, 8);
    ctx.fill();
    ctx.stroke();

    // Right spoke
    ctx.beginPath();
    ctx.rect(18, -4, 26, 8);
    ctx.fill();
    ctx.stroke();

    // Bottom spoke
    ctx.beginPath();
    ctx.rect(-4, 18, 8, 26);
    ctx.fill();
    ctx.stroke();

    // 3. Center Hub
    const hubGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
    hubGrad.addColorStop(0, "#1e293b");
    hubGrad.addColorStop(0.8, "#0f172a");
    hubGrad.addColorStop(1, "#38bdf8");
    ctx.fillStyle = hubGrad;
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4. Emblem
    ctx.fillStyle = "#ec4899";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    // 5. Red Top marker
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(0, -48, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawItemPickup(ctx, cx, cy) {
    ctx.save();
    
    // Outer red glow
    ctx.shadowColor = "#ff3b30";
    ctx.shadowBlur = 12;
    
    // Draw red circle
    ctx.fillStyle = "#ff453a";
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0; // Reset shadow

    // Inner white circle
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();

    // Draw red plus sign
    ctx.fillStyle = "#ff453a";
    ctx.fillRect(cx - 2, cy - 6, 4, 12);
    ctx.fillRect(cx - 6, cy - 2, 12, 4);

    ctx.restore();
}

function spawnSparks(x, y, count = 10, color = "#ff007f") {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const pSpeed = Math.random() * 4 + 2;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * pSpeed,
            vy: Math.sin(angle) * pSpeed - (Math.random() * 2), // upward bias
            size: Math.random() * 3 + 2,
            color: color,
            alpha: 1,
            life: 0,
            maxLife: 30 + Math.random() * 20
        });
    }
}

function spawnSpeedLines(count = 2) {
    for (let i = 0; i < count; i++) {
        particles.push({
            type: 'speedline',
            x: Math.random() * 860,
            y: -100,
            len: Math.random() * 40 + 30,
            size: Math.random() * 2 + 1,
            color: "rgba(56, 189, 248, 0.45)"
        });
    }
}

// Main Physics update function
function updateGame() {
    // 1. Cruising & Boosting Speed Logic
    const boostPressed = keys["ArrowUp"] || keys["w"] || keys["W"];
    if (engineState === "RUNNING") {
        if (boostPressed && speed > 1) {
            boostActive = true;
            targetSpeed = maxSpeed * 1.8; // boost speed multiplier
            speed += (targetSpeed - speed) * 0.08;
            score += Math.floor(speed / 2);
            screenShake = Math.max(screenShake, (speed / maxSpeed) * 1.5);
        } else {
            boostActive = false;
            targetSpeed = maxSpeed;
            speed += (targetSpeed - speed) * 0.04;
            score += Math.floor(speed / 4);
        }
    } else {
        boostActive = false;
        targetSpeed = 0;
        speed += (targetSpeed - speed) * 0.04;
    }

    if (score > highScore) {
        highScore = score;
        localStorage.setItem("drowsy_high_score", highScore);
    }

    // 2. Control Handling (Steering playerX)
    if (engineState === "RUNNING" && speed > 1) {
        if (keys["ArrowLeft"] || keys["a"] || keys["A"]) {
            playerX -= 4.5;
        }
        if (keys["ArrowRight"] || keys["d"] || keys["D"]) {
            playerX += 4.5;
        }

        // Restrict steering boundaries (Road edges: X = 250 to 610)
        // With car width 44, half-width 22:
        // Left boundary: 250 + 22 = 272
        // Right boundary: 610 - 22 = 588
        if (playerX < 272) playerX = 272;
        if (playerX > 588) playerX = 588;

        // Spark effect when scraping guard rails
        if (playerX <= 274) {
            score = Math.max(0, score - 2);
            screenShake = Math.max(screenShake, 1.2);
            // Sparks on left rail (X = 250)
            spawnSparks(250, 380, 2, "#cbd5e1");
        } else if (playerX >= 586) {
            score = Math.max(0, score - 2);
            screenShake = Math.max(screenShake, 1.2);
            // Sparks on right rail (X = 610)
            spawnSparks(610, 380, 2, "#cbd5e1");
        }
    } else if (engineState === "STOPPED") {
        // Autopilot Emergency parking pull-over sequence
        // Pull over to far-left safety shoulder (playerX = 272)
        const targetParkX = 272;
        if (Math.abs(playerX - targetParkX) > 0.5) {
            const steerRate = 2.0 * (speed / maxSpeed) + 0.5;
            if (playerX < targetParkX) {
                playerX = Math.min(targetParkX, playerX + steerRate);
            } else {
                playerX = Math.max(targetParkX, playerX - steerRate);
            }
        }
    } else {
        // Slowly center player when stationary
        playerX += (430 - playerX) * 0.05;
    }

    // 3. Scroll Road Y
    roadY = (roadY + speed * 2.5) % 100;
    scrollOffset += speed * 2.5;

    // 4. Manage Obstacles spawning (3 vertical lanes)
    const currentTime = performance.now();
    if (engineState === "RUNNING" && speed > 2) {
        if (currentTime - lastObstacleTime > 1500 && obstacles.length < 3 && Math.random() < 0.04) {
            const randomLane = Math.floor(Math.random() * 3); // 0 (Left), 1 (Center), 2 (Right)
            const laneXCoord = 310 + randomLane * 120;
            
            // Check if there is already a recently spawned car in that lane
            const tooClose = obstacles.some(obs => obs.lane === randomLane && obs.y < 120);
            if (!tooClose) {
                obstacles.push({
                    lane: randomLane,
                    x: laneXCoord,
                    y: -80,
                    color: getRandomColor(),
                    speedOffset: Math.random() * 2.0 - 1.0,
                    carKey: getObstacleCarKey()
                });
                lastObstacleTime = currentTime;
            }
        }

        // 5. Manage Item Spawning (Red Circle Plus Pickups)
        if (currentTime - lastItemTime > 3000 && itemPickups.length < 2 && Math.random() < 0.02) {
            const randomLane = Math.floor(Math.random() * 3);
            const laneXCoord = 310 + randomLane * 120;
            const tooClose = itemPickups.some(it => it.lane === randomLane && it.y < 150) || 
                             obstacles.some(obs => obs.lane === randomLane && obs.y < 150);
            if (!tooClose) {
                itemPickups.push({
                    lane: randomLane,
                    x: laneXCoord,
                    y: -50
                });
                lastItemTime = currentTime;
            }
        }
    }

    // 6. Update obstacles position & check collisions
    obstacles = obstacles.filter((obs) => {
        // Move obstacles down the road relative to player speed
        obs.y += (speed * 0.8) + (1.5 - obs.speedOffset);

        // Check for collision with player car
        if (engineState === "RUNNING") {
            const dx = Math.abs(playerX - obs.x);
            const dy = Math.abs(380 - obs.y);
            if (dx < 36 && dy < 66) {
                // Collision!
                score = Math.max(0, score - 200);
                flashRedFrames = 15;
                screenShake = 20;

                // Spawn splash of sparks
                spawnSparks((playerX + obs.x) / 2, (380 + obs.y) / 2, 18, "#ff3b30");
                return false; // Remove collided car
            }
        }

        // Dodge reward point
        if (obs.y > 520) {
            if (engineState === "RUNNING") {
                score += 150;
            }
            return false;
        }

        return true;
    });

    // 7. Update Item Pickups & collect them
    itemPickups = itemPickups.filter((it) => {
        it.y += speed * 0.8;

        // Check collection collision
        const dx = Math.abs(playerX - it.x);
        const dy = Math.abs(380 - it.y);
        if (dx < 30 && dy < 45) {
            // Picked up!
            score += 500;
            spawnSparks(it.x, it.y, 12, "#ff2d55");
            return false;
        }

        return it.y < 520;
    });

    // 8. Update Particles
    particles = particles.filter(p => {
        if (p.type === 'speedline') {
            p.y += speed * 1.5;
            return p.y < 478;
        } else {
            p.x += p.vx;
            p.y += p.vy;
            p.life++;
            p.alpha = 1 - (p.life / p.maxLife);
            return p.life < p.maxLife;
        }
    });

    // Spawn engine flames behind exhaust
    if (engineState === "RUNNING" && speed > 1 && Math.random() < 0.3) {
        particles.push({
            x: playerX - 10,
            y: 380 + 38,
            vx: Math.random() * 1.0 - 0.5,
            vy: Math.random() * 2 + speed * 0.5 + 2,
            size: Math.random() * 2 + 1.5,
            color: "rgba(255, 120, 73, 0.8)",
            alpha: 1,
            life: 0,
            maxLife: 15 + Math.random() * 10
        });
        particles.push({
            x: playerX + 10,
            y: 380 + 38,
            vx: Math.random() * 1.0 - 0.5,
            vy: Math.random() * 2 + speed * 0.5 + 2,
            size: Math.random() * 2 + 1.5,
            color: "rgba(255, 120, 73, 0.8)",
            alpha: 1,
            life: 0,
            maxLife: 15 + Math.random() * 10
        });
    }

    // Spawn speed lines if boosting
    if (boostActive && Math.random() < 0.2) {
        spawnSpeedLines(1);
    }

    // 9. Update steering wheel rotation angle based on user steer inputs / autopilot steering
    let targetWheelAngle = 0;
    if (engineState === "RUNNING" && speed > 1) {
        if (keys["ArrowLeft"] || keys["a"] || keys["A"]) {
            targetWheelAngle = -0.7;
        } else if (keys["ArrowRight"] || keys["d"] || keys["D"]) {
            targetWheelAngle = 0.7;
        }
    } else if (engineState === "STOPPED" && speed > 0.05) {
        // Autopilot turns wheel to pull over left
        targetWheelAngle = -0.5;
    }
    wheelAngle += (targetWheelAngle - wheelAngle) * 0.15;

    // Decay screenshake
    if (screenShake > 0) {
        screenShake = Math.max(0, screenShake - 0.4);
    }

    if (flashRedFrames > 0) flashRedFrames--;
}

function drawGame() {
    // 1. Screenshake Translation
    const shakeX = (Math.random() - 0.5) * screenShake;
    const shakeY = (Math.random() - 0.5) * screenShake;
    
    gameCtx.save();
    gameCtx.translate(shakeX, shakeY);

    // 2. Draw Background Side Grids (Cyberpunk neon look or Scrolling Nature Background)
    if (natureImage && natureImage.complete && natureImage.naturalWidth !== 0) {
        const scaledHeight = 230 * (natureImage.height / natureImage.width);
        const yOffset = (scrollOffset) % scaledHeight;
        
        // Draw left side scenery (X = 0 to 230)
        let startY = yOffset - scaledHeight;
        while (startY < 478) {
            gameCtx.drawImage(natureImage, 0, startY, 230, scaledHeight);
            startY += scaledHeight;
        }

        // Draw right side scenery (X = 630 to 860)
        startY = yOffset - scaledHeight;
        while (startY < 478) {
            gameCtx.drawImage(natureImage, 630, startY, 230, scaledHeight);
            startY += scaledHeight;
        }
    } else {
        // Fallback to Cyberpunk neon look
        gameCtx.fillStyle = "#0c0a1a"; // Dark purple deep space
        gameCtx.fillRect(0, 0, 860, 478);

        // Side scrolling grid lines (Left side X = 0 to 230)
        gameCtx.strokeStyle = "rgba(236, 72, 153, 0.1)";
        gameCtx.lineWidth = 1;
        for (let gx = 15; gx < 230; gx += 40) {
            gameCtx.beginPath();
            gameCtx.moveTo(gx, 0);
            gameCtx.lineTo(gx, 478);
            gameCtx.stroke();
        }
        for (let gy = (roadY * 1.5) % 40; gy < 478; gy += 40) {
            gameCtx.beginPath();
            gameCtx.moveTo(0, gy);
            gameCtx.lineTo(230, gy);
            gameCtx.stroke();
        }

        // Side scrolling grid lines (Right side X = 630 to 860)
        for (let gx = 650; gx < 860; gx += 40) {
            gameCtx.beginPath();
            gameCtx.moveTo(gx, 0);
            gameCtx.lineTo(gx, 478);
            gameCtx.stroke();
        }
        for (let gy = (roadY * 1.5) % 40; gy < 478; gy += 40) {
            gameCtx.beginPath();
            gameCtx.moveTo(630, gy);
            gameCtx.lineTo(860, gy);
            gameCtx.stroke();
        }
    }

    // 3. Draw Asphalt Road Surface (X = 230 to 630)
    if (roadImage && roadImage.complete && roadImage.naturalWidth !== 0) {
        const roadScaledHeight = 400 * (roadImage.height / roadImage.width);
        const roadYOffset = (scrollOffset) % roadScaledHeight;
        let roadStartY = roadYOffset - roadScaledHeight;
        while (roadStartY < 478) {
            gameCtx.drawImage(roadImage, 230, roadStartY, 400, roadScaledHeight);
            roadStartY += roadScaledHeight;
        }
    } else {
        // Fallback road
        gameCtx.fillStyle = "#1e293b"; // Slate asphalt grey
        gameCtx.fillRect(230, 0, 400, 478);

        // Darker asphalt center lanes (X = 250 to 610)
        gameCtx.fillStyle = "#0f172a";
        gameCtx.fillRect(250, 0, 360, 478);
    }

    // 4. Draw Scrolling Dashed Divider Lines (Subtle White Highway Markings)
    gameCtx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    gameCtx.lineWidth = 3;
    gameCtx.setLineDash([25, 25]);
    gameCtx.lineDashOffset = -roadY * 2.2;

    // Left Divider
    gameCtx.beginPath();
    gameCtx.moveTo(370, 0);
    gameCtx.lineTo(370, 478);
    gameCtx.stroke();

    // Right Divider
    gameCtx.beginPath();
    gameCtx.moveTo(490, 0);
    gameCtx.lineTo(490, 478);
    gameCtx.stroke();

    gameCtx.setLineDash([]);

    // 5. Draw speedline warp particles (if boosting)
    for (let p of particles) {
        if (p.type === 'speedline') {
            gameCtx.strokeStyle = p.color;
            gameCtx.lineWidth = p.size;
            gameCtx.beginPath();
            gameCtx.moveTo(p.x, p.y);
            gameCtx.lineTo(p.x, p.y + p.len);
            gameCtx.stroke();
        }
    }

    // 6. Draw Item Pickups (Plus items)
    for (let it of itemPickups) {
        drawItemPickup(gameCtx, it.x, it.y);
    }

    // 7. Draw Obstacle Vehicles (Top-down)
    for (let obs of obstacles) {
        const obsImg = carImages[obs.carKey] || carImages.car2;
        drawCarImage(gameCtx, obs.x, obs.y, obsImg, obs.color, false);
    }

    // 9. Draw Player Vehicle (Top-down Sporty Selected Car)
    const playerImg = carImages[activePlayerCarKey] || carImages.car1;
    drawCarImage(gameCtx, playerX, 380, playerImg, "#f59e0b", true);

    // 9.5 Draw Rotating Steering Wheel on left side of frame
    drawSteeringWheel(gameCtx, 115, 380, wheelAngle);

    // 10. Draw sparks / smoke particles
    for (let p of particles) {
        if (p.type !== 'speedline') {
            gameCtx.save();
            gameCtx.globalAlpha = p.alpha;
            gameCtx.fillStyle = p.color;
            gameCtx.beginPath();
            gameCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            gameCtx.fill();
            gameCtx.restore();
        }
    }

    gameCtx.restore();

    // 11. Draw Telemetry Overlay HUD (Score, High Score)
    gameCtx.fillStyle = "#ffffff";
    gameCtx.font = "600 15px 'Outfit', sans-serif";
    gameCtx.fillText("SCORE", 25, 30);

    gameCtx.fillStyle = "#38bdf8";
    gameCtx.font = "700 24px 'Consolas', monospace";
    gameCtx.fillText(score.toString().padStart(6, '0'), 25, 55);

    gameCtx.fillStyle = "#94a3b8";
    gameCtx.font = "600 12px 'Outfit', sans-serif";
    gameCtx.fillText("HIGH SCORE: " + highScore.toString().padStart(6, '0'), 25, 75);

    // 12. Draw Speed HUD
    gameCtx.fillStyle = "#ffffff";
    gameCtx.font = "600 15px 'Outfit', sans-serif";
    gameCtx.textAlign = "right";
    gameCtx.fillText("SPEED", 835, 30);

    const speedKmh = Math.floor(speed * 22);
    gameCtx.fillStyle = (speedKmh > 0) ? (boostActive ? "#ec4899" : "#38bdf8") : "#ef4444";
    gameCtx.font = "700 24px 'Consolas', monospace";
    gameCtx.fillText(speedKmh + " KM/H", 835, 55);

    if (boostActive) {
        gameCtx.fillStyle = "#ec4899";
        gameCtx.font = "700 11px 'Outfit', sans-serif";
        gameCtx.fillText("WARP BOOST ACTIVE", 835, 74);
    }
    gameCtx.textAlign = "left";

    // 13. Draw Red Collision Overlay
    if (flashRedFrames > 0) {
        gameCtx.fillStyle = `rgba(239, 68, 68, ${0.1 + (flashRedFrames / 15) * 0.4})`;
        gameCtx.fillRect(0, 0, 860, 478);
    }

    // 14. Draw Autopilot safety screens
    if (engineState === "STOPPED") {
        gameCtx.fillStyle = "rgba(8, 5, 20, 0.76)";
        gameCtx.fillRect(0, 0, 860, 478);

        const pulseRatio = (Math.sin(performance.now() / 150) + 1) / 2;
        gameCtx.textAlign = "center";

        if (speed > 0.05 || Math.abs(playerX - 272) > 2) {
            gameCtx.fillStyle = `rgba(245, 158, 11, ${0.85 + pulseRatio * 0.15})`;
            gameCtx.font = "700 36px 'Outfit', sans-serif";
            gameCtx.fillText("AUTOPILOT ENGAGED", 430, 200);

            gameCtx.fillStyle = "#ffffff";
            gameCtx.font = "600 16px 'Outfit', sans-serif";
            gameCtx.fillText("PULLING OVER TO SAFETY EMERGENCY SHOULDER...", 430, 235);

            gameCtx.fillStyle = "#94a3b8";
            gameCtx.font = "500 13px 'Outfit', sans-serif";
            gameCtx.fillText("Drowsiness intervention: Autonomous steering pulling over to left rail.", 430, 260);
        } else {
            gameCtx.fillStyle = `rgba(239, 68, 68, ${0.85 + pulseRatio * 0.15})`;
            gameCtx.font = "700 36px 'Outfit', sans-serif";
            gameCtx.fillText("VEHICLE PARKED SAFELY", 430, 200);

            gameCtx.fillStyle = "#ffffff";
            gameCtx.font = "600 16px 'Outfit', sans-serif";
            gameCtx.fillText("EMERGENCY PARKING COMPLETED & ENGINE SECURED", 430, 235);

            gameCtx.fillStyle = "#94a3b8";
            gameCtx.font = "500 13px 'Outfit', sans-serif";
            gameCtx.fillText("Open eyes to silence siren. Click dashboard START manually to resume driving.", 430, 265);
        }
        gameCtx.textAlign = "left";
    }
}

// Endless Game Loop
function gameLoop() {
    updateGame();
    drawGame();
    requestAnimationFrame(gameLoop);
}

// System Boot Initialization
async function initializeApp() {
    try {
        // 0. Load Game Visual Assets
        carImages.car1 = await loadImage("car1.png");
        carImages.car2 = await loadImage("car2.png");
        carImages.car3 = await loadImage("car3.png");
        roadImage = await loadImage("road.jpg");
        natureImage = await loadImage("nautre.jpg") || await loadImage("nature.jpg");

        // Set up Vehicle Selector Event Listeners
        const vehicleOptions = document.querySelectorAll(".vehicle-option");
        vehicleOptions.forEach(opt => {
            opt.addEventListener("click", () => {
                vehicleOptions.forEach(o => o.classList.remove("active"));
                opt.classList.add("active");
                activePlayerCarKey = opt.getAttribute("data-car");
            });
        });

        // 1. Initialize WASM Fileset Resolver
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        // 2. Load FaceLandmarker Model
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1
        });

        console.log("MediaPipe FaceLandmarker loaded successfully.");

        // 3. Request Webcam Access
        const constraints = {
            video: {
                width: 640,
                height: 480,
                facingMode: "user"
            },
            audio: false
        };

        webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
        webcamElement.srcObject = webcamStream;

        // Wait for video metadata to load before beginning loops
        webcamElement.addEventListener("loadedmetadata", () => {
            // Remove loading screen overlay
            loadingScreen.classList.add("hidden");
            // Start the predictions and game loops
            predictLoop();
            gameLoop();
        });

    } catch (err) {
        console.error("DRIVERALERT AI startup error: ", err);
        loadingScreen.classList.add("hidden");
        cameraError.classList.remove("hidden");

        // Start game loop even if camera fails, so user can play manually
        gameLoop();
    }
}

// Boot System
initializeApp();
