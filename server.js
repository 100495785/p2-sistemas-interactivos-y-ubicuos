const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public"), { index: false }));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

const rooms = {};

function createInitialState() {
  return {
    position: null,
    direction: null,
    stopped: false,
    wrongDirection: false,
    destination: null,
    route: null
  };
}

function ensureRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      navigatorId: null,
      companions: new Set(),
      state: createInitialState()
    };
  }
  return rooms[roomId];
}

io.on("connection", (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.on("JOIN_AS_NAVIGATOR", ({ roomId }) => {
    const room = ensureRoom(roomId);

    socket.join(roomId);
    socket.data.role = "navigator";
    socket.data.roomId = roomId;

    room.navigatorId = socket.id;

    console.log(`[NAV] ${socket.id} joined room ${roomId}`);
    socket.emit("JOINED", { role: "navigator", roomId });

    io.to(roomId).emit("NAVIGATOR_ONLINE", { navigatorId: socket.id });
  });

  socket.on("JOIN_AS_COMPANION", ({ roomId }) => {
    const room = ensureRoom(roomId);

    socket.join(roomId);
    socket.data.role = "companion";
    socket.data.roomId = roomId;

    room.companions.add(socket.id);

    console.log(`[COMP] ${socket.id} joined room ${roomId}`);
    socket.emit("JOINED", { role: "companion", roomId });

    socket.emit("STATE_SNAPSHOT", room.state);

    if (room.navigatorId) {
      socket.emit("NAVIGATOR_ONLINE", { navigatorId: room.navigatorId });
    } else {
      socket.emit("ROOM_EMPTY");
    }
  });

  socket.on("DESTINATION_SET", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    const room = ensureRoom(roomId);
    room.state.destination = data;
    socket.to(roomId).emit("DESTINATION_SET", data);
  });

  socket.on("ROUTE_DATA", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    const room = ensureRoom(roomId);
    room.state.route = data.route || null;

    if (data.destination) {
      room.state.destination = data.destination;
    }

    socket.to(roomId).emit("ROUTE_DATA", data);
  });

  socket.on("POSITION_UPDATE", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    const room = ensureRoom(roomId);
    room.state.position = data;
    socket.to(roomId).emit("POSITION_UPDATE", data);
  });

  socket.on("NEXT_DIRECTION", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    const room = ensureRoom(roomId);
    room.state.direction = data;
    socket.to(roomId).emit("NEXT_DIRECTION", data);
  });

  socket.on("STOPPED", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    const room = ensureRoom(roomId);
    room.state.stopped = true;
    socket.to(roomId).emit("STOPPED", data);
  });

  socket.on("MOVING", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    const room = ensureRoom(roomId);
    room.state.stopped = false;
    socket.to(roomId).emit("MOVING", data);
  });

  socket.on("VOICE_COMMAND", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit("VOICE_COMMAND", data);
  });

  socket.on("WRONG_DIRECTION", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    const room = ensureRoom(roomId);
    room.state.wrongDirection = true;
    socket.to(roomId).emit("WRONG_DIRECTION", data);

    setTimeout(() => {
      if (rooms[roomId]) rooms[roomId].state.wrongDirection = false;
    }, 5000);
  });

  socket.on("COMPANION_QUICK_MESSAGE", (data) => {
    const { roomId, role } = socket.data;
    if (!roomId || role !== "companion") return;

    const room = ensureRoom(roomId);
    if (!room.navigatorId) {
      socket.emit("ROOM_EMPTY");
      return;
    }

    io.to(room.navigatorId).emit("COMPANION_QUICK_MESSAGE", {
      message: data.message,
      timestamp: data.timestamp || Date.now(),
      from: socket.id
    });
  });

  socket.on("disconnect", () => {
    const { roomId, role } = socket.data;
    if (!roomId || !rooms[roomId]) {
      console.log(`[DISCONNECT] ${socket.id} (${role || "unknown"})`);
      return;
    }

    const room = rooms[roomId];

    if (role === "navigator") {
      room.navigatorId = null;
      io.to(roomId).emit("NAVIGATOR_OFFLINE");
      io.to(roomId).emit("ROOM_EMPTY");
    }

    if (role === "companion") {
      room.companions.delete(socket.id);
    }

    if (!room.navigatorId && room.companions.size === 0) {
      delete rooms[roomId];
    }

    console.log(`[DISCONNECT] ${socket.id} (${role || "unknown"})`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🧭 HapticNav server running → http://localhost:${PORT}`);
});