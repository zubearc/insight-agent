const { EventEmitter, once } = require('events')
const { GoogleAIStudioCompletionService, CompletionService, ChatSession, tools } = require('langxlang')
const DEBUGGING = true

async function app (config, users) {
  const service = config.aisPort ? new GoogleAIStudioCompletionService(config.aisPort) : new CompletionService()

  async function s1CallSocialMedia (prompt) {
    const prompt = tools.importPromptSync('./llm/s1Prompt.md', {
      PROMPT: prompt
    })
    const [response] = await service.requestCompletion('gemini-1.5-pro-latest', null, prompt)
    const [json] = tools.extractCodeblockFromMarkdown(response.text)
    if (!json || json.lang !== 'json') {
      return '<FUNCTION_OUTPUT>Error: Service is unavailable, try again</FUNCTION_OUTPUT>'
    }
    const parsed = JSON.parse(json.code)
    if (parsed.message) {
      return `<FUNCTION_OUTPUT>Error: ${parsed.message}</FUNCTION_OUTPUT>`
    }
  }

  const s1SystemPrompt = tools.importRawSync('./llm/s1Prompt.md')
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
      if (!DEBUGGING && aggregate.includes('<FUNCTION_CALL>')) {
        return
      }
      user.send({ type: 'textCompleteChunk', content })
    })

    console.log('Response', response.text)
    if (response.text.includes('<FUNCTION_CALL>')) {
      const call = tools.extractJSFunctionCall(response.text, '<FUNCTION_CALL>')
      console.log('CALL', call)
      user.send({ type: 'switchStage', stage: 2 })
      
    }

    user.send({ type: 'textComplete', content: response.text })
  }

  async function stage2 () {

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