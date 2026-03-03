const socket = io();

let currentSessionId = null;

const input = document.getElementById("sessionInput");
const joinBtn = document.getElementById("joinBtn");
const joinedSpan = document.getElementById("joined");
const stateBox = document.getElementById("stateBox");

joinBtn.addEventListener("click", () => {
  currentSessionId = input.value.trim();
  if (!currentSessionId) return;
  socket.emit("session:join", { sessionId: currentSessionId });
});

socket.on("session:joined", ({ sessionId }) => {
  joinedSpan.textContent = sessionId;
});

socket.on("state:update", (data) => {
  stateBox.textContent = JSON.stringify(data, null, 2);
});