import http from 'node:http';

const PORT = Number(process.env.PORT || 3001);
const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || 30000);
const FALLBACK_ENABLED = String(process.env.AI_FALLBACK ?? 'true').toLowerCase() !== 'false';
const RATE_LIMIT_MAX_WAIT_MS = Math.max(0, Number(process.env.AI_RATE_LIMIT_MAX_WAIT_MS || 12000));
const SINGLE_PROVIDER_429_RETRY = String(process.env.AI_SINGLE_PROVIDER_429_RETRY ?? 'true').toLowerCase() !== 'false';
const PROVIDER_ORDER = String(process.env.AI_PROVIDERS || 'groq,openai,gemini,anthropic,mistral,openrouter')
  .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

const providers = {
  groq: {
    key: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
    kind: 'openai-compatible',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    strictSchema: true,
  },
  openai: {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    kind: 'openai-compatible',
    url: 'https://api.openai.com/v1/chat/completions',
    strictSchema: true,
  },
  mistral: {
    key: process.env.MISTRAL_API_KEY,
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    kind: 'openai-compatible',
    url: 'https://api.mistral.ai/v1/chat/completions',
    strictSchema: false,
  },
  openrouter: {
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-5-mini',
    kind: 'openai-compatible',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    strictSchema: true,
  },
  gemini: {
    key: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    kind: 'gemini',
  },
  anthropic: {
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    kind: 'anthropic',
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const providerCooldownUntil = new Map();

class ProviderHttpError extends Error {
  constructor(provider, status, body = '', retryAfterMs = 0) {
    super(`${provider} HTTP ${status}: ${String(body || '').slice(0, 1200)}`);
    this.name = 'ProviderHttpError';
    this.provider = provider;
    this.status = Number(status || 0);
    this.body = String(body || '');
    this.retryAfterMs = Math.max(0, Number(retryAfterMs || 0));
  }
}

const configuredProviders = () => PROVIDER_ORDER
  .filter((name) => providers[name]?.key)
  .map((name) => ({ name, ...providers[name] }));

const parseRetryAfterMs = (response, body = '') => {
  const retryHeader = response?.headers?.get?.('retry-after');
  if (retryHeader) {
    const seconds = Number(retryHeader);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
    const date = Date.parse(retryHeader);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }

  const resetTokens = response?.headers?.get?.('x-ratelimit-reset-tokens');
  if (resetTokens) {
    const m = String(resetTokens).match(/([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m)?/i);
    if (m) {
      const n = Number(m[1]);
      const unit = String(m[2] || 's').toLowerCase();
      if (Number.isFinite(n)) return Math.ceil(n * (unit === 'ms' ? 1 : unit === 'm' ? 60000 : 1000));
    }
  }

  const text = String(body || '');
  const bodyMatch = text.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|min(?:utes?)?)?/i);
  if (bodyMatch) {
    const n = Number(bodyMatch[1]);
    const unit = String(bodyMatch[2] || 's').toLowerCase();
    if (Number.isFinite(n)) {
      if (unit.startsWith('ms')) return Math.ceil(n);
      if (unit.startsWith('m')) return Math.ceil(n * 60000);
      return Math.ceil(n * 1000);
    }
  }
  return 0;
};

const sendJson = (res, status, payload, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
};

const readBody = (req, maxBytes = 1_500_000) => new Promise((resolve, reject) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
      reject(new Error('Payload trop volumineux.'));
      req.destroy();
    }
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const number = { type: 'number', minimum: 0, maximum: 1 };
const explanation = { type: 'string' };
const int = { type: 'integer' };
const answerSchema = (type) => {
  const base = (properties, required) => ({
    type: 'object', additionalProperties: false,
    properties: { ...properties, confidence: number, explanation },
    required: [...required, 'confidence', 'explanation'],
  });
  switch (type) {
    case 'single-choice':
    case 'button-choice': return base({ choice: int }, ['choice']);
    case 'multi-choice': return base({ choices: { type: 'array', minItems: 1, items: int } }, ['choices']);
    case 'text':
    case 'multi-text': return base({ answers: { type: 'array', items: { type:'object', additionalProperties:false, properties:{ field:int, text:{type:'string'} }, required:['field','text'] } } }, ['answers']);
    case 'select':
    case 'multi-select': return base({ selections: { type:'array', items:{ type:'object', additionalProperties:false, properties:{ field:int, option:int }, required:['field','option'] } } }, ['selections']);
    case 'drag-drop': return base({ placements: { type:'array', items:{ type:'object', additionalProperties:false, properties:{ item:int, zone:int }, required:['item','zone'] } } }, ['placements']);
    case 'ordering': return base({ order: { type:'array', items:int } }, ['order']);
    case 'matching': return base({ pairs: { type:'array', items:{ type:'object', additionalProperties:false, properties:{ left:int, right:int }, required:['left','right'] } } }, ['pairs']);
    case 'matrix': return base({ rows: { type:'array', items:{ type:'object', additionalProperties:false, properties:{ row:int, choice:int }, required:['row','choice'] } } }, ['rows']);
    default: return base({}, []);
  }
};

const extractSystemAndMessages = (messages = []) => {
  const system = messages.filter((m) => m?.role === 'system').map((m) => String(m.content || '')).join('\n\n');
  const chat = messages.filter((m) => m?.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
  return { system, chat };
};

const openAiCompatible = async ({ name, cfg, model, messages, maxTokens, schema }) => {
  const strict = cfg.strictSchema;
  const payload = { model, messages, stream: false };
  if (!/gpt-5|(^|\/)o[1-9]/i.test(model)) payload.temperature = 0;
  if (name === 'groq' || name === 'openai') payload.max_completion_tokens = maxTokens;
  else payload.max_tokens = maxTokens;
  if (strict) {
    payload.response_format = { type: 'json_schema', json_schema: { name: 'global_exam_answer', strict: true, schema } };
  } else {
    payload.response_format = { type: 'json_object' };
  }
  if (name === 'openrouter') payload.plugins = [{ id: 'response-healing' }];

  const doFetch = async (body) => fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(name === 'openrouter' ? { 'HTTP-Referer': 'http://localhost', 'X-Title': 'Global Exam Assistant' } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let response = await doFetch(payload);
  let text = await response.text();
  if (!response.ok && strict && response.status === 400) {
    const fallback = { ...payload, response_format: { type: 'json_object' } };
    response = await doFetch(fallback);
    text = await response.text();
  }
  if (!response.ok) {
    throw new ProviderHttpError(name, response.status, text, parseRetryAfterMs(response, text));
  }
  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${name}: réponse vide.`);
  return String(content);
};

const sanitizeGeminiSchema = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeGeminiSchema);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (['additionalProperties', 'minimum', 'maximum'].includes(key)) continue;
    out[key] = sanitizeGeminiSchema(val);
  }
  return out;
};

const callGemini = async ({ cfg, model, messages, maxTokens, schema }) => {
  const { system, chat } = extractSystemAndMessages(messages);
  const prompt = [system, ...chat.map((m) => `${m.role.toUpperCase()}: ${m.content}`)].filter(Boolean).join('\n\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        responseSchema: sanitizeGeminiSchema(schema),
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new ProviderHttpError('gemini', response.status, text, parseRetryAfterMs(response, text));
  const data = JSON.parse(text);
  const content = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!content) throw new Error('gemini: réponse vide.');
  return content;
};

const callAnthropic = async ({ cfg, model, messages, maxTokens, schema }) => {
  const { system, chat } = extractSystemAndMessages(messages);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      system,
      messages: chat,
      tools: [{ name: 'submit_answer', description: 'Retourner la réponse structurée finale.', input_schema: schema }],
      tool_choice: { type: 'tool', name: 'submit_answer' },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new ProviderHttpError('anthropic', response.status, text, parseRetryAfterMs(response, text));
  const data = JSON.parse(text);
  const tool = data?.content?.find((x) => x?.type === 'tool_use' && x?.name === 'submit_answer');
  if (tool?.input) return JSON.stringify(tool.input);
  const content = data?.content?.filter((x) => x?.type === 'text').map((x) => x.text || '').join('') || '';
  if (!content) throw new Error('anthropic: réponse vide.');
  return content;
};

const callProvider = async ({ name, cfg, model, messages, maxTokens, schema }) => {
  if (cfg.kind === 'gemini') return callGemini({ cfg, model, messages, maxTokens, schema });
  if (cfg.kind === 'anthropic') return callAnthropic({ cfg, model, messages, maxTokens, schema });
  return openAiCompatible({ name, cfg, model, messages, maxTokens, schema });
};

const chooseCandidates = (input) => {
  const configured = configuredProviders();
  if (!configured.length) throw new Error('Aucune clé IA configurée dans .env.');
  const requested = String(input.provider || 'auto').toLowerCase();
  if (requested !== 'auto') {
    const exact = configured.find((x) => x.name === requested);
    if (!exact) throw new Error(`Le fournisseur ${requested} n'est pas configuré.`);
    const rest = FALLBACK_ENABLED ? configured.filter((x) => x.name !== requested) : [];
    return [exact, ...rest];
  }
  const slot = Math.max(0, Number(input.provider_slot || 0));
  const start = slot % configured.length;
  const rotated = [...configured.slice(start), ...configured.slice(0, start)];
  return FALLBACK_ENABLED ? rotated : [rotated[0]];
};

const callCandidateAdaptive = async ({ candidate, model, messages, maxTokens, schema, singleProvider }) => {
  const cooldownUntil = providerCooldownUntil.get(candidate.name) || 0;
  const remainingCooldown = Math.max(0, cooldownUntil - Date.now());
  if (remainingCooldown > 0) {
    if (singleProvider && remainingCooldown <= RATE_LIMIT_MAX_WAIT_MS) {
      console.warn(`[Multi-IA] ${candidate.name}: quota temporaire, attente ${remainingCooldown}ms avant reprise.`);
      await sleep(remainingCooldown + 120);
    } else {
      throw new ProviderHttpError(candidate.name, 429, 'Fournisseur temporairement en cooldown.', remainingCooldown);
    }
  }

  try {
    return await callProvider({ name: candidate.name, cfg: candidate, model, messages, maxTokens, schema });
  } catch (error) {
    if (!(error instanceof ProviderHttpError) || error.status !== 429) throw error;

    const retryAfterMs = Math.max(1000, Number(error.retryAfterMs || 0));
    providerCooldownUntil.set(candidate.name, Date.now() + retryAfterMs);

    if (!singleProvider || !SINGLE_PROVIDER_429_RETRY || retryAfterMs > RATE_LIMIT_MAX_WAIT_MS) throw error;

    console.warn(`[Multi-IA] ${candidate.name}: HTTP 429, attente automatique ${retryAfterMs}ms puis une nouvelle tentative.`);
    await sleep(retryAfterMs + 150);
    providerCooldownUntil.delete(candidate.name);
    return await callProvider({ name: candidate.name, cfg: candidate, model, messages, maxTokens, schema });
  }
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/providers')) {
    const configured = configuredProviders();
    return sendJson(res, 200, {
      ok: configured.length > 0,
      mode: configured.length <= 1 ? 'adaptive-single-provider' : 'adaptive-multi-ai',
      adaptive: true,
      fallback: FALLBACK_ENABLED,
      rate_limit_retry: SINGLE_PROVIDER_429_RETRY,
      rate_limit_max_wait_ms: RATE_LIMIT_MAX_WAIT_MS,
      providers: PROVIDER_ORDER.map((name) => ({
        name,
        configured: !!providers[name]?.key,
        model: providers[name]?.model || null,
        cooldown_ms: Math.max(0, (providerCooldownUntil.get(name) || 0) - Date.now()),
      })),
      configured_count: configured.length,
    });
  }

  if (req.method !== 'POST' || req.url !== '/api/chat') return sendJson(res, 404, { error: 'Not found' });

  try {
    const raw = await readBody(req);
    const input = raw ? JSON.parse(raw) : {};
    const messages = Array.isArray(input.messages) ? input.messages : [];
    if (!messages.length) return sendJson(res, 400, { error: 'messages est requis.' });

    const schema = answerSchema(String(input.question_type || ''));
    const maxTokens = Number.isFinite(Number(input.max_completion_tokens))
      ? Math.max(32, Math.min(2048, Number(input.max_completion_tokens))) : 320;
    const candidates = chooseCandidates(input);
    const configuredCount = configuredProviders().length;
    const singleProvider = configuredCount === 1;
    const errors = [];

    for (const candidate of candidates) {
      const forcedModel = input.model && input.model !== 'auto' ? String(input.model) : null;
      const model = forcedModel || candidate.model;
      try {
        const content = await callCandidateAdaptive({ candidate, model, messages, maxTokens, schema, singleProvider });
        JSON.parse(String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
        return sendJson(res, 200, {
          provider: candidate.name,
          model,
          adaptive: true,
          configured_count: configuredCount,
          choices: [{ index: 0, message: { role: 'assistant', content } }],
        });
      } catch (error) {
        const msg = error?.message || String(error);
        const retryAfterMs = Number(error?.retryAfterMs || 0);
        errors.push({ provider: candidate.name, status: Number(error?.status || 0) || null, retry_after_ms: retryAfterMs || null, error: msg });
        console.error(`[Multi-IA] ${candidate.name}: ${msg}`);
      }
    }

    const rateLimited = errors.length > 0 && errors.every((x) => x.status === 429);
    const retryAfterMs = Math.max(0, ...errors.map((x) => Number(x.retry_after_ms || 0)));
    if (rateLimited) {
      return sendJson(res, 429, {
        error: 'Fournisseur IA temporairement limité.',
        retry_after_ms: retryAfterMs,
        attempts: errors,
      }, retryAfterMs ? { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } : {});
    }

    return sendJson(res, 502, { error: 'Tous les fournisseurs IA ont échoué.', attempts: errors });
  } catch (error) {
    console.error('[Multi-IA Proxy]', error);
    return sendJson(res, 502, { error: error?.message || String(error) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const names = configuredProviders().map((x) => x.name);
  const mode = names.length <= 1 ? 'fournisseur unique adaptatif' : 'multi-IA adaptatif';
  console.log(`[Multi-IA Proxy] Écoute sur 0.0.0.0:${PORT} — mode ${mode} — fournisseurs: ${names.join(', ') || 'AUCUN'}`);
});
