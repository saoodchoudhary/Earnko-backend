// Simple IO holder to allow emitting from routes
let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}
function getIO() {
  if (!ioInstance) throw new Error('Socket.IO not initialized');
  return ioInstance;
}

module.exports = { setIO, getIO };