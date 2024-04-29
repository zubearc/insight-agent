const ws = require('ws');
const { EventEmitter } = require('events');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function delayed (stack, cb) {
  for (const item of stack) {
    await cb(item)
    await sleep(100)
  }
}

async function main () {
  const emitter = new EventEmitter()
  const server = new ws.Server({ port: 8082 })
  server.on('connection', (socket) => {
    const user = new EventEmitter()
    user.send = (message) => socket.send(JSON.stringify(message))
    delayed([
      { type: 'textCompleteStart', id: 1 },
      { type: 'textCompleteChunk', id: 1, content: 'Hello! What' },
      { type: 'textCompleteChunk', id: 1, content: 'Hello! What is your name?\n' }
    ], (message) => user.send(message))
  })
}

main()