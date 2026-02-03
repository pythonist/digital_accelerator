const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Override CSP headers (this is the whole point)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss:;"
  );
  res.removeHeader('X-Frame-Options');
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback — EXPRESS 5 SAFE
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
