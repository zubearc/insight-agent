const fs = require('fs')
const { parse } = require('node-html-parser')

const UNSAFE = ['israel', 'palestine']

async function getTweets (username) {
  // https://github.com/zedeus/nitter/wiki/Instances
  // alt: https://nitter.esmailelbob.xyz
  let html
  if (fs.existsSync(username + '.html')) {
    html = fs.readFileSync(username + '.html', 'utf8')
  } else {
    html = await fetch('https://nitter.privacydev.net/' + username)
      .then((res) => res.text())
  }
  fs.writeFileSync(username + '.html', html)
  const $ = parse(html)
  const tweets = []
  $.querySelectorAll('.timeline-item').forEach((tweet) => {
    // console.log('tweet entry', tweet)
    const content = tweet.querySelector('.tweet-content')
    tweets.push(content.textContent)
  })
  // console.log('Tweets', [username], tweets)
  return tweets.filter(tweet => tweet.length > 0).filter(tweet => !UNSAFE.some(word => tweet.toLowerCase().includes(word)))
}

async function getPostsOnSubreddit (subreddit) {
  let i = 0
  const allTitles = {}
  const posts = await fetch(`https://www.reddit.com/r/${subreddit}.json`).then(res => res.json())
  const titles = posts.data.children.map(post => ({ i: i++, title: post.data.title, url: post.data.url, created: post.data.created, comments_url: post.data.permalink }))
  console.log(titles)
  for (const title of titles) {
    allTitles[title.title] = title
  }
  return allTitles
}

async function build (fromSearch) {
  const results = []
  let md = ''
  for (const query of fromSearch.queries) {
    if (query.platform === 'reddit') {
      md += `## r/${query.subreddit} on Reddit\n`
      const posts = await getPostsOnSubreddit(query.subreddit)
      for (const title in posts) {
        const post = posts[title]
        md += `\n### ${results.length + 1}\n${post.title}`
        results.push({ handle: query.subreddit, title: post.title, id: results.length + 1, platform: 'reddit' })
      }
    } else if (query.platform === 'twitter') {
      md += `## @${query.handle} on X (Twitter)\n`
      const tweets = await getTweets(query.handle)
      for (let i = 0; i < tweets.length; i++) {
        const tweet = tweets[i]
        md += `\n### ${results.length + 1}\n${tweet}`
        results.push({ handle: query.handle, title: tweet, id: results.length + 1, platform: 'twitter' })
      }
    }
  }
  return { md, results }
}

const MOCK_stage2data = {
  'Reddit': [
    [0, '<b>r/singularity</b> - LLaMA 3, now with 160K+ context. Posted by u/ai_enthusiast'],
    [1, '<b>r/ai</b> - Phi 3, the latest iteration of the Phi series, is now available for download. Posted by u/ai_enthusiast'],
  ],
  'Twitter / X': [
    [2, '<b>@tsnuchia</b> - Just read about LLaMA 3, the latest model from Meta. Looks like it has some cool new features! #ai #nlp'],
    [3, '<b>@ai_enthusiast</b> - Phi 3 is out! Check out the latest iteration of the Phi series for some cool new features. #ai #nlp'],
  ]
}

async function buildObject (buildResult) {
  const results = {
    'Reddit': [],
    'Twitter / X': []
  }
  for (const result of buildResult) {
    const title = result.handle + ' - ' + result.title
    if (result.platform === 'reddit') {
      results['Reddit'].push([result.id, title])
    } else if (result.platform === 'twitter') {
      results['Twitter / X'].push([result.id, title])
    }
  }
  return results
}

async function test () {
  let md = '## @elonmusk on X (Twitter)'
  const tweets = await getTweets('elonmusk')
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i]
    md += `\n### ${i + 1}\n${tweet}`
  }
  fs.writeFileSync('test.md', md)
}

if (require.main === module) {
  test()
}

module.exports = {
  getTweets,
  getPostsOnSubreddit,
  build, // for us
  buildObject // for frontend
}
