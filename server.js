const http = require('http');
const https = require('https');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const SEARCH_PROVIDER_URL = 'https://html.duckduckgo.com/html/';

function buildDuckDuckGoSearchBody(query, start) {
  return new URLSearchParams({
    q: String(query || ''),
    s: String(start || '0'),
  }).toString();
}

function logProxyEvent(label, data) {
  console.log(`[search-proxy] ${label}: ${JSON.stringify(data)}`);
}

function createProxyHandler(port) {
  return (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('DuckDuckGo proxy OK');
      return;
    }

    const urlObject = new URL(req.url, `http://localhost:${port}`);
    if (urlObject.pathname !== '/search') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const query = urlObject.searchParams.get('q') || '';
    const requestedStart = urlObject.searchParams.get('s') || '0';
    const start = /^\d+$/.test(requestedStart) ? requestedStart : '0';
    const searchBody = buildDuckDuckGoSearchBody(query, start);
    const duckDuckGoUrl = new URL(SEARCH_PROVIDER_URL);

    logProxyEvent('query sent', {
      query,
      start,
      method: 'POST',
      url: duckDuckGoUrl.toString(),
      body: searchBody,
    });

    const options = {
      hostname: duckDuckGoUrl.hostname,
      path: duckDuckGoUrl.pathname,
      method: 'POST',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(searchBody),
        Origin: `${duckDuckGoUrl.protocol}//${duckDuckGoUrl.hostname}`,
        Referer: duckDuckGoUrl.toString(),
      },
    };

    const proxyRequest = https.request(options, (proxyResponse) => {
      const chunks = [];

      proxyResponse.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      proxyResponse.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        const body = bodyBuffer.toString('utf8');
        const statusCode = proxyResponse.statusCode || 502;
        const contentType = proxyResponse.headers['content-type'] || 'text/html; charset=utf-8';

        logProxyEvent('response received', {
          query,
          start,
          statusCode,
          bodyLength: bodyBuffer.length,
        });

        res.writeHead(statusCode, { 'Content-Type': contentType });
        res.end(body);
      });
    });

    proxyRequest.setTimeout(10000, () => {
      proxyRequest.destroy(new Error('DuckDuckGo request timed out'));
    });

    proxyRequest.on('error', (error) => {
      console.error(`[search-proxy] request failed: ${JSON.stringify({
        query,
        start,
        message: error.message,
      })}`);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Error: ${error.message}`);
    });

    proxyRequest.write(searchBody);
    proxyRequest.end();
  };
}

function startProxyServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port || DEFAULT_PORT;

  return new Promise((resolve, reject) => {
    const server = http.createServer(createProxyHandler(port));

    server.once('error', (error) => {
      if (error.code !== 'EADDRINUSE') {
        reject(error);
        return;
      }

      const probe = http.get({ host, port, path: '/' }, (response) => {
        response.resume();
        resolve({ server: null, port, reused: true });
      });

      probe.once('error', () => reject(error));
    });

    server.listen(port, host, () => {
      resolve({ server, port, reused: false });
    });
  });
}

async function runStandalone() {
  try {
    const { port, reused } = await startProxyServer();
    if (reused) {
      console.log(`DuckDuckGo proxy already running at http://localhost:${port}`);
      return;
    }

    console.log(`DuckDuckGo proxy running at http://localhost:${port}`);
    console.log('Leave this process open while using the retro search homepage.');
  } catch (error) {
    console.error(`Unable to start the DuckDuckGo proxy: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runStandalone();
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  startProxyServer,
};
