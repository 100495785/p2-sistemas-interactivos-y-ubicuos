const socket = io();

let currentSessionId = null;

const input = document.getElementById("sessionInput");
const joinBtn = document.getElementById("joinBtn");
const joinedSpan = document.getElementById("joined");
const presenceSpan = document.getElementById("presence");
const stateBox = document.getElementById("stateBox");
const eventLog = document.getElementById("eventLog");
const commandButtons = Array.from(document.querySelectorAll("[data-cmd]"));

function pushLog(text) {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${text}`;
  eventLog.textContent = `${line}\n${eventLog.textContent}`.trim();
}

function sendCommand(cmd, data = {}) {
  if (!currentSessionId) {
    pushLog("No session joined");
    return;
  }

  socket.emit("command:send", {
    sessionId: currentSessionId,
    cmd,
    data
  });
}

joinBtn.addEventListener("click", () => {
  currentSessionId = input.value.trim();
  if (!currentSessionId) return;
  socket.emit("session:join", { sessionId: currentSessionId, role: "monitor" });
});

commandButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const cmd = btn.dataset.cmd;
    const turn = btn.dataset.turn;

    if (cmd === "nav:set-turn") {
      sendCommand(cmd, { turn });
      pushLog(`Command sent: ${cmd} (${turn})`);
      return;
    }

    sendCommand(cmd);
    pushLog(`Command sent: ${cmd}`);
  });
});

socket.on("session:joined", ({ sessionId, role }) => {
  joinedSpan.textContent = sessionId;
  pushLog(`Joined ${sessionId} as ${role}`);
});

socket.on("session:presence", (summary) => {
  if (!summary || summary.sessionId !== currentSessionId) return;
  presenceSpan.textContent = `walker: ${summary.hasWalker ? "online" : "offline"}, monitors: ${summary.monitors}`;
});

socket.on("state:update", (data) => {
  if (data.sessionId !== currentSessionId) return;
  stateBox.textContent = JSON.stringify(data, null, 2);
});

socket.on("command:recv", (packet) => {
  if (!packet) return;
  pushLog(`Command relay: ${packet.cmd} (${packet.source})`);
});

socket.on("session:ended", ({ sessionId, reason }) => {
  if (sessionId !== currentSessionId) return;
  pushLog(`Session ended (${reason})`);
  currentSessionId = null;
  joinedSpan.textContent = "-";
  presenceSpan.textContent = "-";
});

socket.on("session:error", ({ message }) => {
  pushLog(`Session error: ${message}`);
});
