const axios = require('axios')
const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY

// Extract video ID from YouTube URL
function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
  const match = url.match(regExp)
  return (match && match[2].length === 11) ? match[2] : null
}

// Get YouTube video metadata using YouTube Data API
async function getVideoMetadata(videoId) {
  try {
    if (!YOUTUBE_API_KEY) {
      throw new Error('YouTube API key not configured')
    }

    const response = await axios.get(`https://www.googleapis.com/youtube/v3/videos`, {
      params: {
        part: 'snippet,statistics,contentDetails',
        id: videoId,
        key: YOUTUBE_API_KEY
      }
    })

    if (response.data.items && response.data.items.length > 0) {
      const video = response.data.items[0]
      return {
        title: video.snippet.title,
        description: video.snippet.description || '',
        channelTitle: video.snippet.channelTitle,
        publishedAt: video.snippet.publishedAt,
        tags: video.snippet.tags || [],
        categoryId: video.snippet.categoryId,
        viewCount: video.statistics.viewCount,
        likeCount: video.statistics.likeCount,
        commentCount: video.statistics.commentCount,
        duration: video.contentDetails.duration,
        thumbnails: video.snippet.thumbnails
      }
    }
    
    throw new Error('Video not found')
  } catch (error) {
    console.error('YouTube API error:', error.response?.data || error.message)
    throw new Error(`Failed to fetch video metadata: ${error.message}`)
  }
}

// Get video transcript using youtube-transcript
async function getVideoTranscript(videoId) {
  try {
    const { YoutubeTranscript } = require('youtube-transcript')
    const transcript = await YoutubeTranscript.fetchTranscript(videoId)
    return transcript.map(item => item.text).join(' ')
  } catch (error) {
    console.error('Transcript error:', error.message)
    return null
  }
}

// Format duration from YouTube format (PT4M13S) to readable format
function formatDuration(duration) {
  if (!duration) return 'Unknown'
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/)
  if (!match) return duration
  
  const hours = (match[1] || '').replace('H', '')
  const minutes = (match[2] || '').replace('M', '')
  const seconds = (match[3] || '').replace('S', '')
  
  let result = ''
  if (hours) result += `${hours}h `
  if (minutes) result += `${minutes}m `
  if (seconds) result += `${seconds}s`
  
  return result.trim() || duration
}

// Clean formatting for models that need it
function cleanFormatting(text) {
  return text
    .replace(/\*\*\*\*/g, '**') // Fix quadruple asterisks
    .replace(/(\d+)\.\s*/g, '\n\n**$1.** ') // Format numbered lists
    .replace(/\n{3,}/g, '\n\n') // Clean multiple newlines
    .replace(/^(.+):$/gm, '**$1:**') // Make headers bold
    .trim()
}

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
  }

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    }
  }

  // Handle GET request for health check
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'OK',
        message: 'YouTube Summarizer API is running',
        timestamp: new Date().toISOString(),
        geminiApiKeyExists: !!process.env.GEMINI_API_KEY,
        youtubeApiKeyExists: !!process.env.YOUTUBE_API_KEY,
        features: ['Real video metadata', 'Video transcripts', 'AI analysis']
      })
    }
  }

  // Handle POST request for summarization
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  try {
    const { youtube_link, model, additional_prompt } = JSON.parse(event.body)

    if (!youtube_link) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'YouTube link is required' })
      }
    }

    const videoId = extractVideoId(youtube_link)
    if (!videoId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid YouTube URL' })
      }
    }

    console.log('🎬 Processing video ID:', videoId)

    // Get both metadata and transcript in parallel
    const [metadata, transcript] = await Promise.all([
      getVideoMetadata(videoId).catch(err => {
        console.error('Metadata fetch failed:', err.message)
        return { title: 'Title unavailable', description: 'Metadata unavailable', channelTitle: 'Unknown' }
      }),
      getVideoTranscript(videoId).catch(err => {
        console.error('Transcript fetch failed:', err.message)
        return null
      })
    ])

    console.log('📊 Video title:', metadata.title)
    console.log('📝 Transcript available:', !!transcript)

    // Build comprehensive prompt with all available data
    let prompt = `Please analyze this YouTube video using the following information:

**📺 VIDEO DETAILS:**
- Title: ${metadata.title}
- Channel: ${metadata.channelTitle}
- Duration: ${formatDuration(metadata.duration)}
- Views: ${metadata.viewCount ? Number(metadata.viewCount).toLocaleString() : 'Unknown'}
- Published: ${metadata.publishedAt ? new Date(metadata.publishedAt).toLocaleDateString() : 'Unknown'}
- Likes: ${metadata.likeCount ? Number(metadata.likeCount).toLocaleString() : 'Unknown'}

**📄 DESCRIPTION:**
${metadata.description ? metadata.description.substring(0, 1000) + (metadata.description.length > 1000 ? '...' : '') : 'No description available'}

${metadata.tags && metadata.tags.length > 0 ? `**🏷️ TAGS:** ${metadata.tags.slice(0, 10).join(', ')}` : ''}

${transcript ? `**📝 VIDEO TRANSCRIPT:**
${transcript.substring(0, 6000)}${transcript.length > 6000 ? '...(transcript continues)' : ''}` : '**📝 TRANSCRIPT:** Not available (video may not have captions)'}

**🎯 ANALYSIS REQUEST:**
Based on the above information, please provide a comprehensive analysis with the following structure:

🎬 **Video Overview**
What is this video about? What's the main topic?

🎯 **Purpose & Goals** 
What is the creator trying to achieve or teach?

🔑 **Key Points & Takeaways**
List the most important points discussed (based on transcript if available)

💡 **Main Insights & Lessons**
What are the key insights viewers will gain?

👥 **Target Audience**
Who would benefit most from watching this video?

📚 **Content Type & Style**
Educational, entertainment, tutorial, review, etc.

⭐ **Value Proposition**
What specific value does this video provide?

📋 **Summary**
Provide a comprehensive summary of the content

IMPORTANT: Use the emoji headers exactly as shown above (🎬 **Video Overview**, not "Video Overview" followed by "🎬 Video Overview"). Do not repeat section titles.`

    if (additional_prompt && additional_prompt.trim()) {
      prompt += `\n\n**🎨 SPECIAL INSTRUCTIONS:** ${additional_prompt}`
    }

    // Configure model
    const modelName = model || "gemini-1.5-flash"
    const genModel = genAI.getGenerativeModel({ model: modelName })

    let generationConfig = {
      temperature: 0.7,
      topP: 0.8,
      maxOutputTokens: 3000,
    }

    // Adjust config based on model
    if (modelName.includes('2.0')) {
      generationConfig.temperature = 0.6
      generationConfig.maxOutputTokens = 8192
      prompt += "\n\n**FORMATTING INSTRUCTIONS:** Please structure your response with clear emoji headers (🎬, 🎯, 🔑, etc.) and use bullet points with * for lists. Use **bold** for emphasis."
    } else {
      // Default for 1.5-flash - add specific anti-duplication instruction
      prompt += "\n\n**FORMATTING INSTRUCTIONS:** Please use the emoji section headers exactly as specified above. Do NOT write plain text headers before emoji headers. Start each section directly with the emoji (e.g., '🎬 **Video Overview**' not 'Video Overview' followed by '🎬 Video Overview')."
    }

    console.log('🤖 Generating analysis with model:', modelName)
    
    const result = await genModel.generateContent(prompt, { generationConfig })
    const response = await result.response
    let summary = response.text()

    // Post-process for better formatting
    if (modelName.includes('2.0')) {
      summary = cleanFormatting(summary)
    }

    console.log('✅ Analysis generated successfully')

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        summary: summary,
        model_used: modelName,
        video_url: youtube_link,
        video_id: videoId,
        video_metadata: {
          title: metadata.title,
          channel: metadata.channelTitle,
          duration: formatDuration(metadata.duration),
          views: metadata.viewCount,
          likes: metadata.likeCount,
          published: metadata.publishedAt
        },
        analysis_quality: {
          has_metadata: !!metadata.title,
          has_transcript: !!transcript,
          transcript_length: transcript ? transcript.length : 0,
          content_richness: transcript ? 'High' : 'Medium'
        },
        timestamp: new Date().toISOString()
      })
    }

  } catch (error) {
    console.error('❌ Error:', error)
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to analyze video',
        details: error.message
      })
    }
  }
}