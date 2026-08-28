import http from 'node:http';

const PORT = Number(process.env.PORT || 3001);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

if (!GROQ_API_KEY) {
  console.error('[Groq Proxy] GROQ_API_KEY manquante. Cree un fichier .env a partir de .env.example.');
  process.exit(1);
}

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};

const readBody = (req, maxBytes = 1_000_000) => new Promise((resolve, reject) => {
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

const commonProperties = {
  confidence: { type: 'number' },
  explanation: { type: 'string' },
};

const objectSchema = (properties, required) => ({
  type: 'object',
  properties: { ...properties, ...commonProperties },
  required: [...required, 'confidence', 'explanation'],
  additionalProperties: false,
});

const schemas = {
  'single-choice': objectSchema({
    choice: { type: 'integer' },
  }, ['choice']),

  'button-choice': objectSchema({
    choice: { type: 'integer' },
  }, ['choice']),

  'multi-choice': objectSchema({
    choices: { type: 'array', items: { type: 'integer' } },
  }, ['choices']),

  text: objectSchema({
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'integer' },
          text: { type: 'string' },
        },
        required: ['field', 'text'],
        additionalProperties: false,
      },
    },
  }, ['answers']),

  'multi-text': objectSchema({
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'integer' },
          text: { type: 'string' },
        },
        required: ['field', 'text'],
        additionalProperties: false,
      },
    },
  }, ['answers']),

  select: objectSchema({
    selections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'integer' },
          option: { type: 'integer' },
        },
        required: ['field', 'option'],
        additionalProperties: false,
      },
    },
  }, ['selections']),

  'multi-select': objectSchema({
    selections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'integer' },
          option: { type: 'integer' },
        },
        required: ['field', 'option'],
        additionalProperties: false,
      },
    },
  }, ['selections']),

  'drag-drop': objectSchema({
    placements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'integer' },
          zone: { type: 'integer' },
        },
        required: ['item', 'zone'],
        additionalProperties: false,
      },
    },
  }, ['placements']),

  ordering: objectSchema({
    order: { type: 'array', items: { type: 'integer' } },
  }, ['order']),

  matching: objectSchema({
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          left: { type: 'integer' },
          right: { type: 'integer' },
        },
        required: ['left', 'right'],
        additionalProperties: false,
      },
    },
  }, ['pairs']),

  matrix: objectSchema({
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row: { type: 'integer' },
          choice: { type: 'integer' },
        },
        required: ['row', 'choice'],
        additionalProperties: false,
      },
    },
  }, ['rows']),
};

const responseFormatFor = (questionType) => {
  const schema = schemas[questionType];
  if (!schema) return null;
  return {
    type: 'json_schema',
    json_schema: {
      name: `global_exam_${String(questionType).replace(/[^a-z0-9_]/gi, '_')}_answer`,
      strict: true,
      schema,
    },
  };
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      ok: true,
      provider: 'groq',
      model: DEFAULT_MODEL,
      structured_outputs: true,
    });
  }

  if (req.method !== 'POST' || req.url !== '/api/chat') {
    return sendJson(res, 404, { error: 'Not found' });
  }

  try {
    const raw = await readBody(req);
    const input = raw ? JSON.parse(raw) : {};
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const questionType = String(input.question_type || '').trim();

    if (!messages.length) {
      return sendJson(res, 400, { error: 'messages est requis.' });
    }

    const responseFormat = responseFormatFor(questionType);
    if (!responseFormat) {
      return sendJson(res, 400, {
        error: `question_type non gere: ${questionType || '(vide)'}`,
        supported_types: Object.keys(schemas),
      });
    }

    const payload = {
      model: String(input.model || DEFAULT_MODEL),
      messages,
      max_completion_tokens: Number.isFinite(Number(input.max_completion_tokens))
        ? Math.max(32, Math.min(2048, Number(input.max_completion_tokens)))
        : 300,
      reasoning_effort: 'none',
      response_format: responseFormat,
      stream: false,
    };

    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      console.error(`[Groq Proxy] HTTP ${upstream.status}: ${text}`);
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(text);
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch (error) {
    console.error('[Groq Proxy]', error);
    sendJson(res, 502, { error: error?.message || String(error) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Groq Proxy] Ecoute sur 0.0.0.0:${PORT} — modele par defaut: ${DEFAULT_MODEL}`);
});
