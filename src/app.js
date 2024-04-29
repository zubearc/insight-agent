const { EventEmitter, once } = require('events')
const { GoogleAIStudioCompletionService, CompletionService, ChatSession, tools } = require('langxlang')

async function app (config, users) {
  const service = config.aisPort ? new GoogleAIStudioCompletionService(config.aisPort) : new CompletionService()

  const s1SystemPrompt = tools.importPromptSync('./llm/s1Prompt.md')
  async function stage1 (user, messages) {
    messages = structuredClone(messages)
    // const session = new ChatSession(service, 'gemini-1.5-pro-latest', s1SystemPrompt)
    if (!messages.every(message => ['user', 'assistant'].includes(message.role))) {
      return user.kill('Bad request')
    }
    messages.unshift({ role: 'system', content: s1SystemPrompt })
    let aggregate = ''
    const [response] = await service.requestChatCompletion('gemini-1.5-pro-latest', {
      messages,
      generationOptions: {
        stopSequences: ['</FUNCTION_CALL>']
      }
    }, function chunk ({ content }) {
      aggregate += content
      // if (aggregate.includes('<FUNCTION_CALL>')) {
      //   return // function calls are internal to us
      // }
      user.send({ type: 'textCompleteChunk', content })
    })

    console.log('Response', response.text)
    if (response.text.includes('<FUNCTION_CALL>')) {
      const call = tools.extractJSFunctionCall(response.text, '<FUNCTION_CALL>')
      console.log('CALL', call)
    }

    user.send({ type: 'textComplete', content: response.text })
  }

  users.on('join', (user) => {
    user.on('textCompleteRequest', ({ stage, messages}) => {
      switch (stage) {
        case 1: return stage1(user, messages)
        default: return user.kill('Bad request')
      }
    })
    user.on('message', (message) => {
      switch (message.type) {
        case 'textCompleteRequest': return user.emit('textCompleteRequest', message)
      }
    })
  })
}

function test () {
  const emitter = new EventEmitter()
  app({ aisPort: null }, emitter)
  const user = new EventEmitter()
  emitter.emit('join', user)
  user.send = function (message) {
    if (message.type === 'textCompleteChunk') {
      if (message.content) {
        process.stdout.write(message.content)
      } else {
        process.stdout.write('\n')
      }
    } else {
      if (message.type === 'textComplete') {
        user.emit('textComplete', message)
      }
      console.log(message)
    }
  }

  run()

  async function run () {
    const messages = [
      { role: 'user', content: 'Hello' }
    ]
    user.emit('textCompleteRequest', { stage: 1, messages })
    const { content } = await once(user, 'textComplete')
    console.log('Done 1!')
    messages.push({ role: 'assistant', content })
    messages.push({ role: 'user', content: 'Can you show me the latest tweets from Elon?' })
    user.emit('textCompleteRequest', { stage: 1, messages })
    const { content: content2 } = await once(user, 'textComplete')
    console.log('Result', content2)
  }
}

if (require.main === module) {
  test()
}
module.exports = app