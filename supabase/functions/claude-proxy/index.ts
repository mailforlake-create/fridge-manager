const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages, max_tokens, model_url } = await req.json()
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    const targetUrl = `${model_url}?key=${apiKey}`

    async function fetchWithRetry(url: string, options: any, retries = 3): Promise<any> {
      for (let i = 0; i < retries; i++) {
        const response = await fetch(url, options)
        const data = await response.json()
        if (data.error?.code === 503) {
          if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)))
          continue
        }
        return data
      }
      throw new Error('服务暂时不可用，请稍后重试')
    }

    const requestBody = JSON.stringify({
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

    const data = await fetchWithRetry(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody
    })
    if (data.promptFeedback?.blockReason) {
      return new Response(
        JSON.stringify({ error: `内容被拦截: ${data.promptFeedback.blockReason}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

    if (!text) {
      console.error('Empty response:', JSON.stringify(data))
      return new Response(
        JSON.stringify({ error: 'AI返回空响应', detail: JSON.stringify(data) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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