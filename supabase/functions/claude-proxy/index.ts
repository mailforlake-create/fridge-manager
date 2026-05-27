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
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: '服务端未配置 GEMINI_API_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const targetUrl = `${model_url}${String(model_url).includes('?') ? '&' : '?'}key=${apiKey}`

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
    if (!response.ok) {
      const upstreamError = data?.error?.message || data?.error || `Gemini上游请求失败（HTTP ${response.status}）`
      const details = {
        status: response.status,
        promptFeedback: data?.promptFeedback || null,
        finishReason: data?.candidates?.[0]?.finishReason || null
      }
      return new Response(
        JSON.stringify({ error: `${upstreamError} | ${JSON.stringify(details)}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const candidates = Array.isArray(data?.candidates) ? data.candidates : []
    const text = candidates
      .flatMap((c: any) => (Array.isArray(c?.content?.parts) ? c.content.parts : []))
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n')
    const firstCandidatePreview = (() => {
      try {
        return JSON.stringify(candidates[0] || null).slice(0, 1200)
      } catch {
        return ''
      }
    })()
    const rawResponsePreview = (() => {
      try {
        return JSON.stringify(data || null).slice(0, 1800)
      } catch {
        return ''
      }
    })()

    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text }],
        raw: {
          promptFeedback: data?.promptFeedback || null,
          usageMetadata: data?.usageMetadata || null,
          modelVersion: data?.modelVersion || null,
          candidateCount: candidates.length,
          firstCandidatePreview,
          rawResponsePreview,
          candidates: candidates.map((c: any) => ({
            finishReason: c?.finishReason || null,
            parts_count: Array.isArray(c?.content?.parts) ? c.content.parts.length : 0,
            part_kinds: (Array.isArray(c?.content?.parts) ? c.content.parts : []).map((p: any) =>
              p?.text !== undefined ? 'text' : p?.inlineData ? 'inlineData' : p?.functionCall ? 'functionCall' : 'unknown'
            )
          }))
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
