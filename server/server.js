const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const sessions = new Map();

const PORT = 3000;
const SESSION_ID_LENGTH = 6;

app.use(express.static(path.join(__dirname, "..", "public")));

function generateSessionId() {
  return Math.random().toString(36).slice(2, 2 + SESSION_ID_LENGTH);
}

function buildEmptyState(sessionId) {
  return {
    sessionId,
    ts: Date.now(),
    pos: null,
    heading: null,
    motion: { moving: false, confidence: 0 },
    nav: {
      status: "idle",
      routeIndex: 0,
      routeLength: 0,
      instruction: "Waiting movement",
      nextTurn: "none",
      distanceToNext: null
    },
    interaction: {
      selectedAction: "none",
      lastVoiceCommand: "none",
      pendingExit: false
    }
  };
}

function getOrCreateSession(sessionId) {
  if (sessions.has(sessionId)) {
    return sessions.get(sessionId);
  }

  const session = {
    id: sessionId,
    walkerSocketId: null,
    monitors: new Set(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastCommand: null,
    lastState: buildEmptyState(sessionId)
  };

  sessions.set(sessionId, session);
  return session;
}

function getSessionSummary(session) {
  return {
    sessionId: session.id,
    hasWalker: Boolean(session.walkerSocketId),
    monitors: session.monitors.size,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastCommand: session.lastCommand,
    lastState: session.lastState
  };
}

function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const shouldDelete = !session.walkerSocketId && session.monitors.size === 0;
  if (shouldDelete) {
    sessions.delete(sessionId);
  }
}

function updatePresence(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  io.to(sessionId).emit("session:presence", getSessionSummary(session));
}

io.on("connection", (socket) => {
  socket.data.role = "unknown";
  socket.data.sessionId = null;

  socket.on("session:create", () => {
    const sessionId = generateSessionId();
    const session = getOrCreateSession(sessionId);

    session.walkerSocketId = socket.id;
    session.updatedAt = Date.now();
    session.lastState = buildEmptyState(sessionId);

    socket.data.role = "walker";
    socket.data.sessionId = sessionId;
    socket.join(sessionId);

    socket.emit("session:created", { sessionId });
    socket.emit("session:summary", getSessionSummary(session));
    updatePresence(sessionId);
  });

  socket.on("session:join", ({ sessionId, role = "monitor" } = {}) => {
    if (!sessionId) {
      socket.emit("session:error", { message: "Missing sessionId" });
      return;
    }

    const session = getOrCreateSession(sessionId);

    if (role === "walker") {
      session.walkerSocketId = socket.id;
    } else {
      session.monitors.add(socket.id);
    }

    session.updatedAt = Date.now();

    socket.data.role = role;
    socket.data.sessionId = sessionId;
    socket.join(sessionId);

    socket.emit("session:joined", { sessionId, role });
    socket.emit("session:summary", getSessionSummary(session));
    updatePresence(sessionId);
  });

  socket.on("walker:state", (payload) => {
    if (!payload || !payload.sessionId) return;

    const session = sessions.get(payload.sessionId);
    if (!session) return;

    session.lastState = payload;
    session.updatedAt = Date.now();

    io.to(payload.sessionId).emit("state:update", payload);
  });

  socket.on("command:send", ({ sessionId, cmd, data = {} } = {}) => {
    if (!sessionId || !cmd) return;

    const session = sessions.get(sessionId);
    if (!session) return;

    const packet = {
      cmd,
      data,
      source: socket.data.role || "unknown",
      ts: Date.now()
    };

    session.lastCommand = packet;
    session.updatedAt = Date.now();

    io.to(sessionId).emit("command:recv", packet);
    io.to(sessionId).emit("session:summary", getSessionSummary(session));
  });

  socket.on("session:end", ({ sessionId, reason = "manual" } = {}) => {
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;

    io.to(sessionId).emit("session:ended", { sessionId, reason, ts: Date.now() });
    sessions.delete(sessionId);
  });

  socket.on("disconnect", () => {
    const { sessionId, role } = socket.data;
    if (!sessionId) return;

    const session = sessions.get(sessionId);
    if (!session) return;

    if (role === "walker" && session.walkerSocketId === socket.id) {
      session.walkerSocketId = null;
    }

    if (role === "monitor") {
      session.monitors.delete(socket.id);
    }

    session.updatedAt = Date.now();
    updatePresence(sessionId);
    cleanupSession(sessionId);
  });
});

server.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
