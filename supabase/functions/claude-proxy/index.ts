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

    // 把前端传来的 Claude 格式消息转换成 Gemini 格式
    const contents = body.messages.map((msg: any) => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }
      }
      // 多模态：图片 + 文字
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { 
          maxOutputTokens: body.max_tokens || 4096,
          responseMimeType: "application/json"  // ← 让 Gemini 直接输出 JSON，不带代码块
        }
        }),
      }
    )

    const data = await response.json()
    console.log('Gemini raw:', JSON.stringify(data))

    if (data.error) throw new Error(data.error.message)

    // 转换成前端期望的 Claude 格式，让前端代码不用改
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