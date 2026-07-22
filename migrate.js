const fs = require('fs');

const code = fs.readFileSync('server/index.mjs', 'utf8');

let modified = code.replace(
  "const server = http.createServer(async (req, res) => {",
  "export default async function handler(req, res) {"
);

modified = modified.replace(
  `});\n\nserver.listen(port, '127.0.0.1', () => console.log(\`Creonnect server listening on http://127.0.0.1:\${port}\`));`,
  `}`
);

// Update requestBody to handle Vercel's req.body
modified = modified.replace(
  "function requestBody(req) {",
  "function requestBody(req) {\n  if (req.body) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);"
);

// Vercel handles CORS differently, let's update json helper just in case
modified = modified.replace(
  "    'access-control-allow-origin': allowedOrigin,",
  "    'access-control-allow-origin': req.headers.origin || allowedOrigin,"
);

// We need to change the function signature of json to accept req to get req.headers.origin,
// or just allow '*' or the dynamic origin.
// Let's modify json function:
modified = modified.replace(
  "function json(res, status, body, extra = {}) {",
  "function json(res, status, body, extra = {}) {\n  const origin = typeof res.req !== 'undefined' ? (res.req.headers.origin || '*') : '*';"
);
modified = modified.replace(
  "'access-control-allow-origin': allowedOrigin",
  "'access-control-allow-origin': origin"
);

if (!fs.existsSync('api')) fs.mkdirSync('api');
fs.writeFileSync('api/index.js', modified);
console.log('Migration complete');
