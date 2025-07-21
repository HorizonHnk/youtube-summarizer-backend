const express = require('express')
const cors = require('cors')
require('dotenv').config()
const axios = require('axios')
const { GoogleGenerativeAI } = require('@google/generative-ai')

const app = express()
const PORT = process.env.PORT || 5000

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY

app.use(cors({
  origin: '*',
  credentials: true
}))
app.use(express.json())

// Extract video ID from YouTube URL
function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
  const match = url.match(regExp)
  return (match && match[2].length === 11) ? match[2] : null
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'YouTube Summarizer Backend is running!',
    timestamp: new Date().toISOString(),
    env: {
      gemini: !!process.env.GEMINI_API_KEY,
      youtube: !!process.env.YOUTUBE_API_KEY
    }
  })
})

// Simple test endpoint
app.post('/summarize', async (req, res) => {
  try {
    const { youtube_link, model, additional_prompt } = req.body

    if (!youtube_link) {
      return res.status(400).json({ error: 'YouTube link is required' })
    }

    const videoId = extractVideoId(youtube_link)
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' })
    }

    // For now, return a test response
    // We'll add the full Gemini integration after deployment works
    res.json({
      success: true,
      message: 'Backend is working! Video analysis will be added next.',
      video_url: youtube_link,
      video_id: videoId,
      model_used: model || 'gemini-1.5-flash',
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({
      error: 'Failed to process request',
      details: error.message
    })
  }
})

app.listen(PORT, () => {
  console.log(🚀 Server running on port )
  console.log(🔑 Gemini API Key: )
  console.log(📺 YouTube API Key: )
})
