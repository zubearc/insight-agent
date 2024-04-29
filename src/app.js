const { EventEmitter, once } = require('events')
const { GoogleAIStudioCompletionService, CompletionService, ChatSession, tools } = require('langxlang')
const ws = require('ws')
const socials = require('./tools/collectSocial')
const DEBUGGING = true

async function app (config, users) {
  const service = config.aisPort ? new GoogleAIStudioCompletionService(config.aisPort) : new CompletionService()

  async function s2CallSocialMedia (user, prompt) {
    const modelPrompt = tools.importPromptSync('./llm/s2Prompt.md', {
      PROMPT: prompt
    })
    const [response] = await service.requestCompletion('gemini-1.5-pro-latest', null, modelPrompt)
    fs.writeFileSync('__s2Response.md', response.text)
    const [json] = tools.extractCodeblockFromMarkdown(response.text)
    if (!json || json.lang !== 'json') {
      return user.send({ type: 'insertDialogue', role: 'user', content: '<FUNCTION_OUTPUT>Error: Service is unavailable, try again</FUNCTION_OUTPUT>' })
    }
    const parsed = JSON.parse(json.code)
    if (parsed.message) {
      return user.send({ type: 'insertDialogue', role: 'user', content: `<FUNCTION_OUTPUT>Error: ${parsed.message}</FUNCTION_OUTPUT>` })
    }
    const md = socials.build(parsed)
    user.send({ type: 'switchStage', stage: 2 })
    return s3CallSocialMedia(prompt, json.code, md)
  }

  async function s3CallSocialMedia (s1Prompt, s2Response, s2CompiledOut) {
    const prompt = tools.importPromptSync('./llm/s3PromptSocial.md', {
      PROMPT: s1Prompt,
      STAGE2: s2Response,
      COLLECTED_SOCIALS: s2CompiledOut
    })
    const [response] = await service.requestCompletion('gemini-1.gemini-1.5-pro-latest', null, prompt)
    fs.writeFileSync('__s3Response.md', response.text)
    const [md] = tools.extractCodeblockFromMarkdown(response.text)
    const parsed = tools._parseMarkdown(md.code)
    console.log('Parsed', parsed)
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
    const id = Date.now()
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
      user.send({ type: 'textCompleteChunk', content, id })
    })

    console.log('Response', response.text)
    if (response.text.includes('<FUNCTION_CALL>')) {
      const call = tools.extractJSFunctionCall(response.text, '<FUNCTION_CALL>')
      console.log('CALL', call)
      if (call.name === 'get_social_media_news') {
        const result = await s2CallSocialMedia(user, call.args[0])
        user.send({ type: 'textComplete', content: result, id })
      }
    }
    const responseText = response.text.split('<FUNCTION_CALL>')[0]
    if (responseText.trim()) {
      user.send({ type: 'textComplete', content: responseText.trim(), id })
    }
  }

  async function stage2 () {

  }

  users.on('join', (user) => {
    user.on('textCompleteRequest', ({ stage, messages }) => {
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

function main () {
  // start up a websocket server
  const server = new ws.Server({ port: 8082 })
  const emitter = new EventEmitter()
  app({ aisPort: null }, emitter)
  server.on('connection', (socket) => {
    const user = new EventEmitter()
    user.send = (message) => socket.send(JSON.stringify(message))
    emitter.emit('join', user)
    socket.on('message', (data) => {
      const message = JSON.parse(data)
      user.emit('message', message)
    })
  })
}

if (require.main === module) {
  test()
  // main()
}
module.exports = app