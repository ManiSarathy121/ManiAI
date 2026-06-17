const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const FILE_PATH = path.join(__dirname, 'index.html');
const USERDATA_DIR = path.join(__dirname, 'userdata');

function ensureUserdataDir() {
  if (!fs.existsSync(USERDATA_DIR)) {
    fs.mkdirSync(USERDATA_DIR, { recursive: true });
  }
}

const server = http.createServer((req, res) => {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/powerbi/discover') {
    const scriptPath = path.join(__dirname, 'pbi_tools.ps1');
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action discover`, (err, stdout, stderr) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(stdout || stderr);
      }
    });
    return;
  }

  if (pathname === '/api/powerbi/schema') {
    const port = parsedUrl.searchParams.get('port') || 0;
    const scriptPath = path.join(__dirname, 'pbi_tools.ps1');
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action schema -Port ${port}`, (err, stdout, stderr) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(stdout || stderr);
      }
    });
    return;
  }

  if (pathname === '/api/powerbi/proxy') {
    const port = parsedUrl.searchParams.get('port');
    if (!port) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Port query parameter is required');
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const http = require('http');
      const proxyReq = http.request({
        hostname: 'localhost',
        port: port,
        path: '/xmla',
        method: req.method,
        headers: {
          'Content-Type': 'text/xml',
          'SOAPAction': req.headers['soapaction'] || ''
        }
      }, (proxyRes) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + err.message);
      });
      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // --- Users List Sync API ---
  if (pathname === '/api/users') {
    ensureUserdataDir();
    const usersFile = path.join(USERDATA_DIR, 'users.json');
    
    if (req.method === 'GET') {
      if (fs.existsSync(usersFile)) {
        fs.readFile(usersFile, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, users: JSON.parse(data) }));
          }
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, users: null }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload && Array.isArray(payload.users)) {
            fs.writeFile(usersFile, JSON.stringify(payload.users, null, 2), 'utf8', (err) => {
              if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
              }
            });
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid payload structure' }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Malformed JSON' }));
        }
      });
    }
    return;
  }

  // --- User Settings and History Sync API ---
  if (pathname === '/api/user/data') {
    ensureUserdataDir();
    
    if (req.method === 'GET') {
      const username = parsedUrl.searchParams.get('username');
      if (!username) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Username is required' }));
        return;
      }
      
      const safeUserKey = username.toLowerCase().replace(/[^a-z0-9_\-]/g, '');
      const userFile = path.join(USERDATA_DIR, `data_${safeUserKey}.json`);
      
      if (fs.existsSync(userFile)) {
        fs.readFile(userFile, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          } else {
            try {
              const payload = JSON.parse(data);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, settings: payload.settings, chats: payload.chats }));
            } catch(e) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Corrupt storage file' }));
            }
          }
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, settings: null, chats: null }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload && payload.username) {
            const safeUserKey = payload.username.toLowerCase().replace(/[^a-z0-9_\-]/g, '');
            const userFile = path.join(USERDATA_DIR, `data_${safeUserKey}.json`);
            const fileData = {
              settings: payload.settings,
              chats: payload.chats
            };
            
            fs.writeFile(userFile, JSON.stringify(fileData, null, 2), 'utf8', (err) => {
              if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
              }
            });
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid payload structure' }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Malformed JSON' }));
        }
      });
    }
    return;
  }

  const isHtmlRequest = pathname === '/' || 
                        pathname === '/Mani_AI_Chat.html' || 
                        pathname === '/Mani_AI_Chat.html' || 
                        pathname === '/Mani_AI_Chat.html';

  if (isHtmlRequest) {
    fs.readFile(FILE_PATH, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading Mani_AI_Chat.html: ' + err.message);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log('===================================================');
  console.log('         ✳ Mani AI Workspace Local Server ✳         ');
  console.log('===================================================');
  console.log(`Running at: ${url}`);
  console.log('Allows direct CORS-free connection to local 9Router!');
  console.log('Press Ctrl+C to stop the server.');
  console.log('---------------------------------------------------');
  
  // Auto-open browser only when running locally (not on cloud platform)
  if (!process.env.PORT) {
    try {
      const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${start} ${url}`);
    } catch (e) {
      console.log('Could not auto-open browser:', e.message);
    }
  }
});
