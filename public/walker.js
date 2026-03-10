const socket = io();

let sessionId = null;
let running = false;
let paused = false;
let pendingExit = false;
let heading = null;
let position = null;
let watchId = null;
let heartbeatTimer = null;
let isMoving = false;
let motionConfidence = 0;
let lastMovementAt = 0;
let lastAutoRepeatAt = 0;
let lastTiltAt = 0;
let lastAcceleration = null;
let speech = null;
let speechActive = false;
let selectedMenuIndex = 0;
let forcedTurn = null;

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const sessionSpan = document.getElementById("sessionId");
const statusSpan = document.getElementById("status");
const movementSpan = document.getElementById("movementState");
const voiceSpan = document.getElementById("voiceState");
const instructionP = document.getElementById("instruction");
const nextTurnSpan = document.getElementById("nextTurn");
const distanceSpan = document.getElementById("distance");
const eventLog = document.getElementById("eventLog");
const airMenu = document.getElementById("airMenu");

const route = [
  { instruction: "Camina recto 120m", turn: "straight", distance: 120 },
  { instruction: "Gira a la izquierda en la siguiente esquina", turn: "left", distance: 40 },
  { instruction: "Continua recto hasta la plaza", turn: "straight", distance: 90 },
  { instruction: "Gira a la derecha en Calle Mayor", turn: "right", distance: 35 },
  { instruction: "Has llegado al destino", turn: "arrive", distance: 0 }
];

let routeIndex = 0;

const VIBRATION_PATTERNS = {
  left: [120, 70, 120],
  right: [120, 70, 120, 70, 120],
  straight: [120],
  repeat: [250],
  arrive: [650, 150, 650],
  confirm: [90, 60, 90, 60, 90]
};

const menuActions = [
  { id: "next", label: "Siguiente indicacion", run: () => advanceInstruction("menu") },
  { id: "repeat", label: "Repetir indicacion", run: () => repeatInstruction("menu") },
  { id: "pause", label: "Pausar / Reanudar", run: () => togglePause("menu") },
  { id: "confirm", label: "Confirmar accion", run: () => confirmAction("menu") },
  { id: "exit", label: "Salir", run: () => requestExit("menu") }
];

function pushLog(text) {
  const line = `[${new Date().toLocaleTimeString()}] ${text}`;
  eventLog.textContent = `${line}\n${eventLog.textContent}`.trim();
}

function vibrate(patternKey) {
  const pattern = VIBRATION_PATTERNS[patternKey];
  if (!pattern || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}

function currentStep() {
  if (forcedTurn) return forcedTurn;
  return route[routeIndex] || route[route.length - 1];
}

function updateView() {
  const step = currentStep();
  sessionSpan.textContent = sessionId || "-";
  statusSpan.textContent = running ? (paused ? "paused" : "running") : "idle";
  movementSpan.textContent = isMoving ? "walking" : "stopped";
  voiceSpan.textContent = speechActive ? "listening" : "inactive";
  instructionP.textContent = step?.instruction || "Sin indicaciones";
  nextTurnSpan.textContent = step?.turn || "-";
  distanceSpan.textContent = typeof step?.distance === "number" ? `${step.distance} m` : "-";
  renderMenu();
}

function renderMenu() {
  airMenu.innerHTML = menuActions
    .map((action, index) => {
      const cls = index === selectedMenuIndex ? "active" : "";
      return `<li class="${cls}">${action.label}</li>`;
    })
    .join("");
}

function emitState() {
  if (!sessionId) return;

  const step = currentStep();
  const payload = {
    sessionId,
    ts: Date.now(),
    pos: position,
    heading,
    motion: {
      moving: isMoving,
      confidence: Number(motionConfidence.toFixed(2))
    },
    nav: {
      status: running ? (paused ? "paused" : "running") : "idle",
      routeIndex,
      routeLength: route.length,
      instruction: step?.instruction || "Sin indicaciones",
      nextTurn: step?.turn || "none",
      distanceToNext: typeof step?.distance === "number" ? step.distance : null
    },
    interaction: {
      selectedAction: menuActions[selectedMenuIndex].id,
      lastVoiceCommand: speechActive ? "listening" : "none",
      pendingExit
    }
  };

  socket.emit("walker:state", payload);
}

function shiftMenu(step) {
  selectedMenuIndex = (selectedMenuIndex + step + menuActions.length) % menuActions.length;
  vibrate("confirm");
  updateView();
  emitState();
}

function selectMenuAction() {
  const action = menuActions[selectedMenuIndex];
  pushLog(`Menu select: ${action.label}`);
  action.run();
}

function cueForTurn(turn) {
  if (turn === "left") vibrate("left");
  if (turn === "right") vibrate("right");
  if (turn === "straight") vibrate("straight");
  if (turn === "arrive") vibrate("arrive");
}

function startNavigationIfNeeded(reason) {
  if (!sessionId || running || paused) return;
  running = true;
  pushLog(`Navigation started (${reason})`);
  cueForTurn(currentStep().turn);
  updateView();
  emitState();
}

function advanceInstruction(source) {
  if (!running) {
    startNavigationIfNeeded(`${source}_auto_start`);
  }

  forcedTurn = null;
  if (routeIndex < route.length - 1) {
    routeIndex += 1;
  }

  const step = currentStep();
  cueForTurn(step.turn);
  pushLog(`Advance (${source}): ${step.instruction}`);

  if (step.turn === "arrive") {
    running = false;
    pushLog("Arrival reached");
  }

  updateView();
  emitState();
}

function repeatInstruction(source) {
  if (!running) {
    startNavigationIfNeeded(`${source}_auto_start`);
  }

  const step = currentStep();
  cueForTurn(step.turn === "arrive" ? "arrive" : "repeat");
  pushLog(`Repeat (${source}): ${step.instruction}`);
  updateView();
  emitState();
}

function togglePause(source) {
  if (!running) {
    startNavigationIfNeeded(`${source}_auto_start`);
  }

  paused = !paused;
  pushLog(`${paused ? "Paused" : "Resumed"} (${source})`);
  updateView();
  emitState();
}

function requestExit(source) {
  pendingExit = true;
  pushLog(`Exit requested (${source}). Confirm to end session.`);
  vibrate("confirm");
  updateView();
  emitState();
}

function confirmAction(source) {
  if (!pendingExit) {
    pushLog(`Action confirmed (${source})`);
    vibrate("confirm");
    return;
  }

  pushLog(`Exit confirmed (${source})`);
  stopSession("confirmed_exit");
}

function forceTurnFromMonitor(turn) {
  const label = turn === "left"
    ? "Giro forzado a la izquierda"
    : turn === "right"
      ? "Giro forzado a la derecha"
      : "Continua recto";

  forcedTurn = { instruction: label, turn, distance: null };
  cueForTurn(turn);
  pushLog(`Forced turn from monitor: ${turn}`);
  updateView();
  emitState();
}

function onMovementDetected(confidence) {
  isMoving = true;
  motionConfidence = confidence;
  lastMovementAt = Date.now();
  startNavigationIfNeeded("movement");
}

function evaluateStopAndRepeat() {
  if (!running || paused) return;
  if (!lastMovementAt) return;

  const now = Date.now();
  if (now - lastMovementAt > 4500) {
    isMoving = false;
    if (now - lastAutoRepeatAt > 9000) {
      lastAutoRepeatAt = now;
      repeatInstruction("auto_stop");
    }
  }
}

function onDeviceOrientation(event) {
  if (typeof event.alpha === "number") {
    heading = Number((360 - event.alpha).toFixed(1));
  }

  const now = Date.now();
  if (now - lastTiltAt < 900) return;

  const gamma = event.gamma ?? 0;
  const beta = event.beta ?? 0;

  if (gamma > 24) {
    shiftMenu(1);
    lastTiltAt = now;
  } else if (gamma < -24) {
    shiftMenu(-1);
    lastTiltAt = now;
  } else if (beta < -24) {
    selectMenuAction();
    lastTiltAt = now;
  }
}

function onDeviceMotion(event) {
  const acc = event.accelerationIncludingGravity || event.acceleration;
  if (!acc) return;

  const current = {
    x: acc.x || 0,
    y: acc.y || 0,
    z: acc.z || 0
  };

  if (lastAcceleration) {
    const delta =
      Math.abs(current.x - lastAcceleration.x) +
      Math.abs(current.y - lastAcceleration.y) +
      Math.abs(current.z - lastAcceleration.z);

    const confidence = Math.min(1, delta / 8);
    if (delta > 1.25) {
      onMovementDetected(confidence);
    }
  }

  lastAcceleration = current;
}

function startGeolocation() {
  if (!navigator.geolocation) {
    pushLog("Geolocation not available");
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (geo) => {
      position = {
        lat: Number(geo.coords.latitude.toFixed(6)),
        lng: Number(geo.coords.longitude.toFixed(6)),
        acc: Number(geo.coords.accuracy.toFixed(1)),
        speed: geo.coords.speed
      };

      if (typeof geo.coords.speed === "number" && geo.coords.speed > 0.35) {
        onMovementDetected(Math.min(1, geo.coords.speed / 2));
      }

      emitState();
    },
    (error) => {
      pushLog(`Geolocation error: ${error.message}`);
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

function stopGeolocation() {
  if (watchId === null) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    pushLog("SpeechRecognition API not available");
    return;
  }

  speech = new SpeechRecognition();
  speech.lang = "es-ES";
  speech.continuous = true;
  speech.interimResults = false;

  speech.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript
      .toLowerCase()
      .trim();

    pushLog(`Voice: ${transcript}`);
    processVoiceCommand(transcript);
  };

  speech.onend = () => {
    if (!sessionId) return;
    if (!speechActive) return;
    speech.start();
  };

  speech.onerror = (event) => {
    pushLog(`Voice error: ${event.error}`);
  };

  speech.start();
  speechActive = true;
  updateView();
}

function stopSpeechRecognition() {
  speechActive = false;
  if (speech) {
    speech.stop();
  }
  updateView();
}

function processVoiceCommand(command) {
  if (command.includes("siguiente") || command.includes("avanza")) {
    advanceInstruction("voice");
    return;
  }

  if (command.includes("repite")) {
    repeatInstruction("voice");
    return;
  }

  if (command.includes("pausa")) {
    if (!paused) togglePause("voice");
    return;
  }

  if (command.includes("reanuda") || command.includes("continua")) {
    if (paused) togglePause("voice");
    return;
  }

  if (command.includes("salir")) {
    requestExit("voice");
    return;
  }

  if (command.includes("confirma") || command.includes("confirmar")) {
    confirmAction("voice");
  }
}

async function requestSensorPermissions() {
  const outcomes = [];

  if (
    typeof window.DeviceMotionEvent !== "undefined" &&
    typeof window.DeviceMotionEvent.requestPermission === "function"
  ) {
    try {
      const result = await window.DeviceMotionEvent.requestPermission();
      outcomes.push(`motion:${result}`);
    } catch {
      outcomes.push("motion:denied");
    }
  }

  if (
    typeof window.DeviceOrientationEvent !== "undefined" &&
    typeof window.DeviceOrientationEvent.requestPermission === "function"
  ) {
    try {
      const result = await window.DeviceOrientationEvent.requestPermission();
      outcomes.push(`orientation:${result}`);
    } catch {
      outcomes.push("orientation:denied");
    }
  }

  if (outcomes.length) pushLog(`Permissions -> ${outcomes.join(", ")}`);
}

function bootSensors() {
  window.addEventListener("deviceorientation", onDeviceOrientation);
  window.addEventListener("devicemotion", onDeviceMotion);
  startGeolocation();

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      evaluateStopAndRepeat();
      updateView();
      emitState();
    }, 1000);
  }
}

function stopSensors() {
  window.removeEventListener("deviceorientation", onDeviceOrientation);
  window.removeEventListener("devicemotion", onDeviceMotion);
  stopGeolocation();

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  lastAcceleration = null;
}

function resetState() {
  running = false;
  paused = false;
  pendingExit = false;
  isMoving = false;
  motionConfidence = 0;
  lastMovementAt = 0;
  lastAutoRepeatAt = 0;
  routeIndex = 0;
  forcedTurn = null;
  selectedMenuIndex = 0;
}

async function startSession() {
  startBtn.disabled = true;
  stopBtn.disabled = false;

  await requestSensorPermissions();
  bootSensors();
  setupSpeechRecognition();

  pushLog("Creating session...");
  socket.emit("session:create");
}

function stopSession(reason, notifyServer = true) {
  if (notifyServer && sessionId) {
    socket.emit("session:end", { sessionId, reason });
  }

  stopSensors();
  stopSpeechRecognition();
  resetState();
  sessionId = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;
  updateView();
}

startBtn.addEventListener("click", () => {
  startSession();
});

socket.on("session:created", ({ sessionId: id }) => {
  sessionId = id;
  pushLog(`Session created: ${sessionId}`);
  startNavigationIfNeeded("start_button");
  updateView();
  emitState();
});

stopBtn.addEventListener("click", () => {
  stopSession("manual_stop");
});

socket.on("command:recv", (packet) => {
  if (!packet) return;

  switch (packet.cmd) {
    case "nav:next":
      advanceInstruction("monitor");
      break;
    case "nav:repeat":
      repeatInstruction("monitor");
      break;
    case "nav:pause":
      if (!paused) togglePause("monitor");
      break;
    case "nav:resume":
      if (paused) togglePause("monitor");
      break;
    case "nav:set-turn":
      if (packet.data?.turn) forceTurnFromMonitor(packet.data.turn);
      break;
    case "exit:request":
      requestExit("monitor");
      break;
    case "exit:confirm":
      confirmAction("monitor");
      break;
    default:
      break;
  }
});

socket.on("session:ended", ({ sessionId: endedId }) => {
  if (!sessionId || endedId !== sessionId) return;
  pushLog("Session closed");
  stopSession("server_closed", false);
});

socket.on("session:error", ({ message }) => {
  pushLog(`Session error: ${message}`);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") shiftMenu(-1);
  if (event.key === "ArrowRight") shiftMenu(1);
  if (event.key === "Enter") selectMenuAction();
});

updateView();
