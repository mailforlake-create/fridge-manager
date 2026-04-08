const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) throw new Error('GEMINI_API_KEY not set')

    const contents = body.messages.map((msg: any) => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }
      }
      const parts = msg.content.map((c: any) => {
        if (c.type === 'text') return { text: c.text }
        if (c.type === 'image') return {
          inline_data: {
            mime_type: c.source.media_type,
            data: c.source.data
          }
        }
        return { text: '' }
      })
      return { role: 'user', parts }
    })

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.1
          }
        }),
      }
    )

    const data = await response.json()
    console.log('Gemini raw:', JSON.stringify(data).substring(0, 500))

    if (data.error) throw new Error(data.error.message)

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return new Response(JSON.stringify({
      content: [{ type: 'text', text }]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})