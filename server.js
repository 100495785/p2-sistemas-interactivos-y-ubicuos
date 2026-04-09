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
  res.sendFile(__dirname + "/public/home.html");
});

// roomId → { navigatorId, state }
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

io.on("connection", (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.on("JOIN_AS_NAVIGATOR", ({ roomId }) => {
    socket.join(roomId);
    socket.data.role = "navigator";
    socket.data.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        navigatorId: null,
        state: createInitialState()
      };
    }

    rooms[roomId].navigatorId = socket.id;

    console.log(`[NAV] ${socket.id} joined room ${roomId}`);
    socket.emit("JOINED", { role: "navigator", roomId });
    io.to(roomId).emit("NAVIGATOR_ONLINE", { navigatorId: socket.id });
  });

  socket.on("JOIN_AS_COMPANION", ({ roomId }) => {
    socket.join(roomId);
    socket.data.role = "companion";
    socket.data.roomId = roomId;

    console.log(`[COMP] ${socket.id} joined room ${roomId}`);
    socket.emit("JOINED", { role: "companion", roomId });

    if (rooms[roomId]) {
      socket.emit("STATE_SNAPSHOT", rooms[roomId].state);
      if (rooms[roomId].navigatorId) {
        socket.emit("NAVIGATOR_ONLINE", { navigatorId: rooms[roomId].navigatorId });
      }
    }
  });

  socket.on("DESTINATION_SET", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        navigatorId: null,
        state: createInitialState()
      };
    }

    rooms[roomId].state.destination = data;
    socket.to(roomId).emit("DESTINATION_SET", data);
  });

  socket.on("ROUTE_DATA", (data) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].state.route = data.route || null;

    if (data.destination) {
      rooms[roomId].state.destination = data.destination;
    }

    socket.to(roomId).emit("ROUTE_DATA", data);
  });

  socket.on("POSITION_UPDATE", (data) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].state.position = data;
    socket.to(roomId).emit("POSITION_UPDATE", data);
  });

  socket.on("NEXT_DIRECTION", (data) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].state.direction = data;
    socket.to(roomId).emit("NEXT_DIRECTION", data);
  });

  socket.on("STOPPED", (data) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].state.stopped = true;
    socket.to(roomId).emit("STOPPED", data);
  });

  socket.on("MOVING", (data) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].state.stopped = false;
    socket.to(roomId).emit("MOVING", data);
  });

  socket.on("VOICE_COMMAND", (data) => {
    const { roomId } = socket.data;
    if (!roomId) return;

    socket.to(roomId).emit("VOICE_COMMAND", data);
  });

  socket.on("WRONG_DIRECTION", (data) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return;

    rooms[roomId].state.wrongDirection = true;
    socket.to(roomId).emit("WRONG_DIRECTION", data);

    setTimeout(() => {
      if (rooms[roomId]) rooms[roomId].state.wrongDirection = false;
    }, 5000);
  });

  socket.on("disconnect", () => {
    const { roomId, role } = socket.data;

    if (roomId && role === "navigator" && rooms[roomId]) {
      rooms[roomId].navigatorId = null;
      io.to(roomId).emit("NAVIGATOR_OFFLINE");
    }

    console.log(`[DISCONNECT] ${socket.id} (${role || "unknown"})`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🧭 HapticNav server running → http://localhost:${PORT}`);
  console.log(`   Navigator: http://localhost:${PORT}/`);
  console.log(`   Companion: http://localhost:${PORT}/companion.html\n`);
});