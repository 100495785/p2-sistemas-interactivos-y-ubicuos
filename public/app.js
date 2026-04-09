/* ═══════════════════════════════════════════════════════
   HAPTICNAV — app.js  (Navegador principal)
═══════════════════════════════════════════════════════ */

"use strict";

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  roomId: null,
  destLat: null,
  destLng: null,
  selectedDestinationName: null,
  usingManualDestination: false,

  currentPos: null,
  lastDirection: null,

  stopTimer: null,
  isStopped: false,
  isListening: false,
  hapticEnabled: true,

  socket: null,
  recognition: null,

  wrongCounter: 0,
  lastDistance: null,

  lastInteractionAt: 0,
  visualTimeout: null,

  routeStarted: false,
  previewSteps: [],

  gpsIntervalId: null,
  isPollingGps: false,

  isRoutePaused: false,

  // Routing real con OSRM
  routeData: null,
  routeCoords: [],
  routeSteps: [],
  currentStepIndex: 0,
  isFetchingRoute: false,
  hasInitialRoute: false,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const setupOverlay              = $("setup-overlay");
const previewScreen             = $("preview-screen");
const navUi                     = $("nav-ui");
const pauseOverlay              = $("pause-overlay");

const roomInput                 = $("room-input");
const destLat                   = $("dest-lat");
const destLng                   = $("dest-lng");

const startBtn                  = $("start-btn");
const backBtn                   = $("back-btn");
const beginRouteBtn             = $("begin-route-btn");
const stopBtn                   = $("stop-btn");
const routeBackBtn              = $("route-back-btn");
const resumeBtn                 = $("resume-btn");

const connDot                   = $("conn-dot");
const connLabel                 = $("conn-label");
const roomTag                   = $("room-tag");
const previewRoomTag            = $("preview-room-tag");

const arrowIcon                 = $("arrow-icon");
const dirLabel                  = $("direction-label");
const distLabel                 = $("distance-label");
const alertBanner               = $("alert-banner");
const latVal                    = $("lat-val");
const lngVal                    = $("lng-val");
const distVal                   = $("dist-val");
const voiceBtn                  = $("voice-btn");

const pillGps                   = $("pill-gps");
const pillVoice                 = $("pill-voice");
const pillHaptic                = $("pill-haptic");
const pillVisual                = $("pill-visual");

const manualFields              = $("manual-destination-fields");
const toggleManualBtn           = $("toggle-manual-btn");
const selectedDestination       = $("selected-destination");
const presetButtons             = document.querySelectorAll(".preset-btn");
const setupError                = $("setup-error");

const previewDestinationName    = $("preview-destination-name");
const previewDestinationCoords  = $("preview-destination-coords");
const previewSteps              = $("preview-steps");

// Visual mode overlay
const visualOverlay = createVisualOverlay();

// ── Direction config ───────────────────────────────────────────────────────
const DIRECTIONS = {
  LEFT:            { arrow: "←", label: "GIRA A LA IZQUIERDA", vibration: [300] },
  RIGHT:           { arrow: "→", label: "GIRA A LA DERECHA",   vibration: [300, 200, 300] },
  STRAIGHT:        { arrow: "↑", label: "CONTINÚA RECTO",      vibration: [] },
  ARRIVED:         { arrow: "⬡", label: "HAS LLEGADO",         vibration: [650] },
  WRONG_DIRECTION: { arrow: "✕", label: "RUTA ERRÓNEA",        vibration: [100, 100, 100, 100, 100] },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — SETUP ERROR
// ─────────────────────────────────────────────────────────────────────────────

function showSetupError(msg) {
  if (!setupError) return;
  setupError.textContent = msg;
  setupError.classList.remove("hidden");
}

function hideSetupError() {
  if (!setupError) return;
  setupError.textContent = "";
  setupError.classList.add("hidden");
}

function updateFooterDestinationInfo() {
  if (latVal) latVal.textContent = state.destLat != null ? state.destLat.toFixed(5) : "—";
  if (lngVal) lngVal.textContent = state.destLng != null ? state.destLng.toFixed(5) : "—";
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP — DESTINOS
// ─────────────────────────────────────────────────────────────────────────────

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    hideSetupError();

    presetButtons.forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");

    state.destLat = parseFloat(btn.dataset.lat);
    state.destLng = parseFloat(btn.dataset.lng);
    state.selectedDestinationName = btn.textContent.trim();

    updateFooterDestinationInfo();

    if (selectedDestination) {
      selectedDestination.textContent = `Destino: ${state.selectedDestinationName}`;
    }
  });
});

if (toggleManualBtn) {
  toggleManualBtn.addEventListener("click", () => {
    hideSetupError();

    state.usingManualDestination = !state.usingManualDestination;

    if (manualFields) {
      manualFields.classList.toggle("hidden", !state.usingManualDestination);
    }

    if (state.usingManualDestination) {
      toggleManualBtn.textContent = "Ocultar coordenadas manuales";
      presetButtons.forEach(b => b.classList.remove("selected"));
      state.destLat = null;
      state.destLng = null;
      state.selectedDestinationName = null;

      updateFooterDestinationInfo();

      if (selectedDestination) {
        selectedDestination.textContent = "Introduce un destino manual";
      }
    } else {
      toggleManualBtn.textContent = "Usar coordenadas manuales";
      if (selectedDestination) {
        selectedDestination.textContent = "Ningún destino seleccionado";
      }
    }
  });
}

if (roomInput) roomInput.addEventListener("input", hideSetupError);
if (destLat) destLat.addEventListener("input", hideSetupError);
if (destLng) destLng.addEventListener("input", hideSetupError);

// ─────────────────────────────────────────────────────────────────────────────
// SETUP — CONFIRMAR DESTINO
// ─────────────────────────────────────────────────────────────────────────────

startBtn.addEventListener("click", () => {
  hideSetupError();

  const room = roomInput.value.trim().toUpperCase();

  if (!room) {
    return showSetupError("Debes introducir un código de sala.");
  }

  state.roomId = room;

  if (state.usingManualDestination) {
    const latValue = destLat?.value ?? "";
    const lngValue = destLng?.value ?? "";

    if (latValue === "" || lngValue === "") {
      return showSetupError("Debes introducir latitud y longitud del destino manual.");
    }

    const lat = parseFloat(latValue);
    const lng = parseFloat(lngValue);

    if (isNaN(lat) || isNaN(lng)) {
      return showSetupError("Las coordenadas manuales no son válidas.");
    }

    state.destLat = lat;
    state.destLng = lng;
    state.selectedDestinationName = "Destino manual";
    updateFooterDestinationInfo();
  } else {
    if (state.destLat == null || state.destLng == null) {
      return showSetupError("Debes seleccionar un destino antes de continuar.");
    }
  }

  buildPreviewSteps();
  showPreviewScreen();
});

backBtn.addEventListener("click", () => {
  previewScreen.classList.add("hidden");
  setupOverlay.classList.add("active");
});

beginRouteBtn.addEventListener("click", () => {
  previewScreen.classList.add("hidden");
  navUi.classList.remove("hidden");
  roomTag.textContent = state.roomId;
  state.routeStarted = true;
  state.isRoutePaused = false;

  updateFooterDestinationInfo();

  try {
    if (navigator.vibrate) navigator.vibrate(1);
  } catch (_) {}

  initSocket();
  initGeolocation();
  initVoiceRecognition();
  initVisibilityDetection();
  initDeviceMotion();
});

stopBtn.addEventListener("click", () => {
  pauseRoute();
});

if (resumeBtn) {
  resumeBtn.addEventListener("click", () => {
    resumeRoute();
  });
}

if (routeBackBtn) {
  routeBackBtn.addEventListener("click", () => {
    leaveRouteAndGoToSetup();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW SCREEN
// ─────────────────────────────────────────────────────────────────────────────

function showPreviewScreen() {
  setupOverlay.classList.remove("active");
  previewScreen.classList.remove("hidden");

  previewRoomTag.textContent = state.roomId;
  previewDestinationName.textContent = state.selectedDestinationName || "Destino seleccionado";
  previewDestinationCoords.textContent = `${state.destLat.toFixed(5)}, ${state.destLng.toFixed(5)}`;

  renderPreviewSteps();
}

function buildPreviewSteps() {
  state.previewSteps = [
    "La ruta peatonal se calculará automáticamente al iniciar",
    "La app seguirá calles reales en lugar de una dirección global simple",
    "Una vibración indicará giro a la izquierda",
    "Dos vibraciones indicarán giro a la derecha",
    "Si te detienes 5 segundos, la indicación se repetirá",
    "Si te sales de la ruta, la app recalculará y avisará por voz",
    "Una vibración larga indicará llegada al destino"
  ];
}

function renderPreviewSteps() {
  previewSteps.innerHTML = "";

  state.previewSteps.forEach((step, index) => {
    const li = document.createElement("li");
    li.className = "preview-step-item";
    li.textContent = `${index + 1}. ${step}`;
    previewSteps.appendChild(li);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE / RESUME / VOLVER
// ─────────────────────────────────────────────────────────────────────────────

function pauseRoute() {
  if (state.isRoutePaused) return;

  state.isRoutePaused = true;
  stopGeolocationPolling();

  clearTimeout(state.stopTimer);

  if (pauseOverlay) {
    pauseOverlay.classList.remove("hidden");
  }

  emit("STOPPED", { timestamp: Date.now(), paused: true });
}

function resumeRoute() {
  if (!state.isRoutePaused) return;

  state.isRoutePaused = false;

  if (pauseOverlay) {
    pauseOverlay.classList.add("hidden");
  }

  initGeolocation();
  emit("MOVING", { timestamp: Date.now(), resumed: true });
}

function leaveRouteAndGoToSetup() {
  stopGeolocationPolling();
  clearTimeout(state.stopTimer);

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch (_) {}
  }

  state.isRoutePaused = false;
  state.routeStarted = false;
  state.isStopped = false;
  state.isPollingGps = false;
  state.lastDirection = null;
  state.currentPos = null;
  state.routeData = null;
  state.routeCoords = [];
  state.routeSteps = [];
  state.currentStepIndex = 0;
  state.hasInitialRoute = false;
  state.isFetchingRoute = false;
  state.lastDistance = null;
  state.wrongCounter = 0;

  if (pauseOverlay) {
    pauseOverlay.classList.add("hidden");
  }

  navUi.classList.add("hidden");
  previewScreen.classList.add("hidden");
  setupOverlay.classList.add("active");

  setConnStatus(false);
  hideAlert();

  arrowIcon.textContent = "—";
  dirLabel.textContent = "ESPERANDO GPS…";
  distLabel.textContent = "";
  distVal.textContent = "—";
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────

function initSocket() {
  if (state.socket?.connected) return;

  state.socket = io(window.location.origin, {
    transports: ["websocket", "polling"]
  });

  state.socket.on("connect", () => {
    setConnStatus(true);

    state.socket.emit("JOIN_AS_NAVIGATOR", {
      roomId: state.roomId
    });

    emit("DESTINATION_SET", {
      latitude: state.destLat,
      longitude: state.destLng,
      name: state.selectedDestinationName,
      timestamp: Date.now()
    });
  });

  state.socket.on("disconnect", () => setConnStatus(false));
  state.socket.on("connect_error", () => setConnStatus(false));
}

function setConnStatus(online) {
  connDot.className = "dot " + (online ? "dot-on" : "dot-off");
  connLabel.textContent = online ? "Conectado" : "Desconectado";
}

function emit(event, data) {
  if (state.socket?.connected) {
    state.socket.emit(event, data);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOLOCATION — POLLING CADA 5 SEGUNDOS
// ─────────────────────────────────────────────────────────────────────────────

function initGeolocation() {
  console.log("Intentando iniciar geolocalización...");

  if (!navigator.geolocation) {
    showAlert("Geolocalización no disponible", false);
    return;
  }

  if (state.isPollingGps) return;

  requestCurrentPosition();

  state.gpsIntervalId = setInterval(() => {
    requestCurrentPosition();
  }, 5000);

  state.isPollingGps = true;
}

function stopGeolocationPolling() {
  if (state.gpsIntervalId) {
    clearInterval(state.gpsIntervalId);
    state.gpsIntervalId = null;
  }
  state.isPollingGps = false;
}

function requestCurrentPosition() {
  navigator.geolocation.getCurrentPosition(
    onPosition,
    (err) => {
      console.warn("GPS error:", err.code, err.message, err);
      setPill(pillGps, false);
      showAlert("No se pudo acceder al GPS.", false);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000
    }
  );
}

async function onPosition(pos) {
  if (state.isRoutePaused) return;

  console.log(
    "GPS OK:",
    pos.coords.latitude,
    pos.coords.longitude,
    "accuracy:",
    pos.coords.accuracy,
    "time:",
    new Date(pos.timestamp).toLocaleTimeString()
  );

  const { latitude: lat, longitude: lng } = pos.coords;
  state.currentPos = { lat, lng };

  setPill(pillGps, true);

  updateFooterDestinationInfo();

  const dist = haversine(lat, lng, state.destLat, state.destLng);
  distVal.textContent = formatDist(dist);
  distLabel.textContent = dist > 0 ? `a ${formatDist(dist)}` : "";

  emit("POSITION_UPDATE", {
    latitude: lat,
    longitude: lng,
    timestamp: Date.now()
  });

  if (!state.hasInitialRoute) {
    await fetchAndStoreRoute(lat, lng, false);
  }

  if (state.routeCoords.length > 1) {
    const offRoute = isOffRoute(lat, lng);

    if (offRoute) {
      applyDirection("WRONG_DIRECTION", true);
      speak("Te has salido de la ruta. Recalculando.");
      await fetchAndStoreRoute(lat, lng, true);
    } else {
      updateStepIndex(lat, lng);
      const dir = getDirectionFromCurrentRouteStep(dist);
      if (state.lastDirection !== "WRONG_DIRECTION") {
        applyDirection(dir);
      } else if (dir === "ARRIVED") {
        applyDirection(dir);
      }
    }
  } else {
    detectWrongDirectionFallback(dist);
    const dir = calcDirectionFallback(lat, lng, state.destLat, state.destLng, dist);

    if (state.lastDirection !== "WRONG_DIRECTION") {
      applyDirection(dir);
    } else if (dir === "ARRIVED") {
      applyDirection(dir);
    }
  }

  onMovementDetected();
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING — OSRM
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAndStoreRoute(originLat, originLng, forceRecalc = false) {
  if (state.isFetchingRoute) return;
  if (!forceRecalc && state.routeCoords.length > 1) return;

  state.isFetchingRoute = true;

  try {
    const url =
      `https://router.project-osrm.org/route/v1/foot/` +
      `${originLng},${originLat};${state.destLng},${state.destLat}` +
      `?overview=full&geometries=geojson&steps=true`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) {
      throw new Error("No se pudo obtener una ruta válida");
    }

    const route = data.routes[0];
    const leg = route.legs?.[0];

    state.routeData = route;
    state.routeCoords = (route.geometry?.coordinates || []).map(([lng, lat]) => ({ lat, lng }));
    state.routeSteps = leg?.steps || [];
    state.currentStepIndex = 0;
    state.hasInitialRoute = true;
    state.lastDistance = null;
    state.wrongCounter = 0;

    emit("ROUTE_DATA", {
      route: state.routeCoords.map(p => ({ latitude: p.lat, longitude: p.lng })),
      destination: {
        latitude: state.destLat,
        longitude: state.destLng,
        name: state.selectedDestinationName
      },
      timestamp: Date.now()
    });

    console.log("Ruta OSRM cargada:", {
      puntos: state.routeCoords.length,
      steps: state.routeSteps.length,
      distance: route.distance
    });
  } catch (error) {
    console.error("Error obteniendo ruta OSRM:", error);
    showAlert("No se pudo calcular la ruta real. Usando modo básico.", false);
  } finally {
    state.isFetchingRoute = false;
  }
}

function updateStepIndex(lat, lng) {
  if (!state.routeSteps.length) return;

  let bestIndex = state.currentStepIndex;
  let bestDist = Infinity;

  for (let i = state.currentStepIndex; i < state.routeSteps.length; i++) {
    const m = state.routeSteps[i]?.maneuver?.location;
    if (!m || m.length < 2) continue;

    const stepLng = m[0];
    const stepLat = m[1];
    const d = haversine(lat, lng, stepLat, stepLng);

    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }

  state.currentStepIndex = bestIndex;
}

function getDirectionFromCurrentRouteStep(distToDestination) {
  if (distToDestination < 15) return "ARRIVED";
  if (!state.routeSteps.length) return "STRAIGHT";

  const step = state.routeSteps[state.currentStepIndex];
  if (!step) return "STRAIGHT";

  const maneuver = step.maneuver || {};
  const modifier = (maneuver.modifier || "").toLowerCase();
  const type = (maneuver.type || "").toLowerCase();

  if (type === "arrive") return "ARRIVED";

  if (modifier.includes("left")) return "LEFT";
  if (modifier.includes("right")) return "RIGHT";

  return "STRAIGHT";
}

function isOffRoute(lat, lng) {
  if (!state.routeCoords.length) return false;

  let minDist = Infinity;

  for (const point of state.routeCoords) {
    const d = haversine(lat, lng, point.lat, point.lng);
    if (d < minDist) minDist = d;
  }

  console.log("Distancia mínima a la ruta:", Math.round(minDist), "m");

  return minDist > 35;
}

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK — LÓGICA ANTIGUA SI FALLA OSRM
// ─────────────────────────────────────────────────────────────────────────────

function detectWrongDirectionFallback(currentDist) {
  if (state.lastDistance == null) {
    state.lastDistance = currentDist;
    return;
  }

  const increased = currentDist > state.lastDistance + 8;

  if (increased) {
    state.wrongCounter++;
  } else {
    state.wrongCounter = 0;
  }

  state.lastDistance = currentDist;

  if (state.wrongCounter >= 3) {
    state.wrongCounter = 0;
    applyDirection("WRONG_DIRECTION", true);

    setTimeout(() => {
      if (state.lastDirection === "WRONG_DIRECTION") {
        state.lastDirection = null;
      }
    }, 4000);
  }
}

function calcDirectionFallback(lat, lng, dLat, dLng, dist) {
  if (dist < 15) return "ARRIVED";

  const bearing = calcBearing(lat, lng, dLat, dLng);

  if (dist < 50) return "STRAIGHT";
  if (bearing > 315 || bearing <= 45) return "STRAIGHT";
  if (bearing > 45 && bearing <= 135) return "RIGHT";
  if (bearing > 135 && bearing <= 225) return "STRAIGHT";
  return "LEFT";
}

// ─────────────────────────────────────────────────────────────────────────────
// APLICAR DIRECCIÓN
// ─────────────────────────────────────────────────────────────────────────────

function applyDirection(dir, force = false) {
  if (state.isRoutePaused) return;

  console.log("DIRECCIÓN:", dir, "force:", force);

  if (dir === state.lastDirection && !force) return;

  state.lastDirection = dir;

  const cfg = DIRECTIONS[dir] || DIRECTIONS.STRAIGHT;
  setArrow(cfg.arrow, cfg.label);

  if (state.hapticEnabled) {
    vibrate(cfg.vibration);
  }

  emit("NEXT_DIRECTION", {
    direction: dir,
    timestamp: Date.now()
  });

  if (dir === "WRONG_DIRECTION") {
    showAlert("⚠ RUTA ERRÓNEA — Recalculando", true);
    emit("WRONG_DIRECTION", { timestamp: Date.now() });
  } else if (dir === "ARRIVED") {
    hideAlert();
    speak("Has llegado al destino.");
  } else {
    hideAlert();
  }
}

function repeatLastIndication() {
  if (!state.lastDirection || state.isRoutePaused) return;
  applyDirection(state.lastDirection, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// STOP DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function onMovementDetected() {
  clearTimeout(state.stopTimer);

  if (state.isStopped) {
    state.isStopped = false;
    emit("MOVING", { timestamp: Date.now() });
  }

  state.stopTimer = setTimeout(() => {
    state.isStopped = true;
    emit("STOPPED", { timestamp: Date.now() });
    repeatLastIndication();
  }, 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE MOTION
// ─────────────────────────────────────────────────────────────────────────────

function initDeviceMotion() {
  window.addEventListener("devicemotion", (e) => {
    if (state.isRoutePaused) return;

    const acc = e.accelerationIncludingGravity;
    if (!acc) return;

    const total = Math.sqrt(
      (acc.x || 0) ** 2 +
      (acc.y || 0) ** 2 +
      (acc.z || 0) ** 2
    );

    if (total > 11.5) onMovementDetected();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE RECOGNITION
// ─────────────────────────────────────────────────────────────────────────────

function initVoiceRecognition() {
  if (state.recognition) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SR) {
    console.warn("SpeechRecognition no disponible");
    setPill(pillVoice, false);
    return;
  }

  const rec = new SR();
  rec.lang = "es-ES";
  rec.continuous = false;
  rec.interimResults = false;

  rec.onresult = (e) => {
    const transcript = e.results[0][0].transcript.toLowerCase().trim();
    handleVoiceCommand(transcript);
  };

  rec.onend = () => {
    state.isListening = false;
    voiceBtn.classList.remove("listening");
    setPill(pillVoice, true);
  };

  rec.onerror = (e) => {
    console.warn("VOZ error:", e.error);
    state.isListening = false;
    voiceBtn.classList.remove("listening");
    setPill(pillVoice, false);
  };

  state.recognition = rec;
  setPill(pillVoice, true);

  voiceBtn.addEventListener("click", () => {
    activateVisualModeTemporarily();

    if (state.isListening) {
      rec.stop();
    } else {
      rec.start();
      state.isListening = true;
      voiceBtn.classList.add("listening");
      setPill(pillVoice, true);
    }
  });
}

async function handleVoiceCommand(text) {
  if (state.isRoutePaused) return;

  emit("VOICE_COMMAND", {
    command: text,
    timestamp: Date.now()
  });

  if (text.includes("repite") || text.includes("repíteme") || text.includes("repeat")) {
    repeatLastIndication();
    speak("Repitiendo indicación.");
  } else if (text.includes("perdido") || text.includes("lost") || text.includes("ayuda")) {
    speak("Voy a recalcular la ruta.");
    if (state.currentPos) {
      state.routeCoords = [];
      state.routeSteps = [];
      await fetchAndStoreRoute(state.currentPos.lat, state.currentPos.lng, true);
      applyDirection("WRONG_DIRECTION", true);
    }
  } else {
    speak("Comando no reconocido.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUAL / HAPTIC FEEDBACK MODE
// ─────────────────────────────────────────────────────────────────────────────

function initVisibilityDetection() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      activateHapticMode();
    }
  });

  activateHapticMode();
}

function activateVisualModeTemporarily() {
  state.lastInteractionAt = Date.now();
  state.hapticEnabled = false;

  setPill(pillHaptic, false);
  setPill(pillVisual, true);
  showVisualMode();

  clearTimeout(state.visualTimeout);
  state.visualTimeout = setTimeout(() => {
    activateHapticMode();
  }, 5000);
}

function activateHapticMode() {
  state.hapticEnabled = true;
  setPill(pillHaptic, true);
  setPill(pillVisual, false);
  hideVisualMode();
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUAL OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

function createVisualOverlay() {
  const el = document.createElement("div");
  el.id = "visual-mode-overlay";
  el.innerHTML = `
    <div class="visual-arrow" id="v-arrow">—</div>
    <div class="visual-text" id="v-text">Esperando indicación...</div>
    <div class="visual-sub">MODO VISUAL ACTIVO</div>
  `;
  document.body.appendChild(el);
  return el;
}

function showVisualMode() {
  visualOverlay.classList.add("active");
  updateVisualMode();
}

function hideVisualMode() {
  visualOverlay.classList.remove("active");
}

function updateVisualMode() {
  if (!state.lastDirection) return;

  const cfg = DIRECTIONS[state.lastDirection];
  if (!cfg) return;

  document.getElementById("v-arrow").textContent = cfg.arrow;
  document.getElementById("v-text").textContent = cfg.label;
}

// ─────────────────────────────────────────────────────────────────────────────
// VIBRATION
// ─────────────────────────────────────────────────────────────────────────────

function vibrate(pattern) {
  console.log("VIBRAR:", pattern, "hapticEnabled:", state.hapticEnabled);

  if (!state.hapticEnabled) return;

  if (!navigator.vibrate) {
    console.warn("Vibration API no disponible");
    return;
  }

  if (!pattern || pattern.length === 0) return;

  try {
    navigator.vibrate(0);
    navigator.vibrate(pattern);
  } catch (error) {
    console.warn("Error al vibrar:", error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEECH SYNTHESIS
// ─────────────────────────────────────────────────────────────────────────────

function speak(text) {
  if (!window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "es-ES";
  utt.rate = 0.9;

  window.speechSynthesis.speak(utt);
}

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function setArrow(symbol, label) {
  arrowIcon.textContent = symbol;
  dirLabel.textContent = label;

  arrowIcon.classList.remove("pulse-anim");
  void arrowIcon.offsetWidth;
  arrowIcon.classList.add("pulse-anim");

  updateVisualMode();
}

function showAlert(msg, isError = true) {
  alertBanner.textContent = msg;
  alertBanner.className = "alert-banner" + (isError ? "" : " hidden");
  alertBanner.classList.remove("hidden");
}

function hideAlert() {
  alertBanner.classList.add("hidden");
}

function setPill(el, active) {
  if (!el) return;
  if (active) el.classList.add("active");
  else el.classList.remove("active");
}

// ─────────────────────────────────────────────────────────────────────────────
// GEO MATH
// ─────────────────────────────────────────────────────────────────────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLng = deg2rad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) *
    Math.cos(deg2rad(lat2)) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcBearing(lat1, lng1, lat2, lng2) {
  const dLng = deg2rad(lng2 - lng1);

  const y = Math.sin(dLng) * Math.cos(deg2rad(lat2));
  const x =
    Math.cos(deg2rad(lat1)) * Math.sin(deg2rad(lat2)) -
    Math.sin(deg2rad(lat1)) *
    Math.cos(deg2rad(lat2)) *
    Math.cos(dLng);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function deg2rad(d) {
  return d * Math.PI / 180;
}

function formatDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}