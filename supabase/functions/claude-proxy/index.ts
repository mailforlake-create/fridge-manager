const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages, max_tokens, model_url } = await req.json()
    const apiKey = Deno.env.get('GEMINI_API_KEY')

    const targetUrl = `${model_url}?key=${apiKey}`

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages.map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: Array.isArray(m.content)
            ? m.content.map((c: any) => {
                if (c.type === 'text') return { text: c.text }
                if (c.type === 'image') return { inlineData: { mimeType: c.source.media_type, data: c.source.data } }
                return { text: '' }
              })
            : [{ text: m.content }]
        })),
        generationConfig: { maxOutputTokens: max_tokens || 4096 }
      })
    })

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

    return new Response(
      JSON.stringify({ content: [{ type: 'text', text }] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})