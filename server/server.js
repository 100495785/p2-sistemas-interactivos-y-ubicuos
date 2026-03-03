// esto es lo minimo

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "..", "public"))); // Servir archivos estáticos desde el directorio público

// Manejar conexiones de Socket.IO
io.on("connection", (socket) => {
  socket.on("session:create", () => {
    const sessionId = Math.random().toString(36).slice(2, 8);
    socket.join(sessionId);
    socket.emit("session:created", { sessionId });
  });

  socket.on("session:join", ({ sessionId }) => {
    socket.join(sessionId);
    socket.emit("session:joined", { sessionId });
  });

  socket.on("walker:state", (payload) => {
    socket.to(payload.sessionId).emit("state:update", payload);
  });

  socket.on("command:send", ({ sessionId, cmd }) => {
    io.to(sessionId).emit("command:recv", { cmd });
  });
});

server.listen(3000, () => console.log("Server on http://localhost:3000")); // Iniciar el servidor en el puerto 3000