const socket = io();

let sessionId = null;
let running = false;
let timer = null;

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const sessionSpan = document.getElementById("sessionId");
const statusSpan = document.getElementById("status");

startBtn.addEventListener("click", () => {
  // 1 toque => crea sesión + empieza
  socket.emit("session:create");
});

socket.on("session:created", ({ sessionId: id }) => {
  sessionId = id;
  sessionSpan.textContent = sessionId;

  running = true;
  statusSpan.textContent = "running";

  startBtn.disabled = true;
  stopBtn.disabled = false;

  // Por ahora enviamos “estado fake” cada 1s CAMBIARLO
  let fakeLat = 40.4168;
  let fakeLng = -3.7038;

  timer = setInterval(() => {
    fakeLat += 0.00001;
    fakeLng += 0.00001;

    socket.emit("walker:state", {
      sessionId,
      ts: Date.now(),
      pos: { lat: fakeLat, lng: fakeLng, acc: 10 },
      heading: 90,
      nav: { nextTurn: "right", distanceToNext: 30, status: "walking" }
    });
  }, 1000);
});

stopBtn.addEventListener("click", () => {
  // “finalizar automático” lo haréis luego cuando lleguéis a destino.
  // De momento, stop manual para testear.
  running = false;
  statusSpan.textContent = "stopped";
  startBtn.disabled = false;
  stopBtn.disabled = true;

  if (timer) clearInterval(timer);
});