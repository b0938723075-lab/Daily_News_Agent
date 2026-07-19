/**
 * Express Server
 * Serves the dashboard and API endpoints
 */
import express from 'express';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadLatestResults } from './pipeline.js';
import { runNewsMaster } from './news_master.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(join(__dirname, '..', 'public')));
app.use(express.json());

// ─── API Routes ───

app.get('/api/news', (req, res) => {
  try {
    const data = loadLatestResults();
    if (!data) {
      return res.json({ timestamp: null, articles: [], summary: null, message: '尚未有資料' });
    }
    res.json(data);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// History endpoint
app.get('/api/history/:date', (req, res) => {
    try {
        const date = req.params.date; // format YYYY-MM-DD
        const fp = join(__dirname, '..', 'data', `history_${date}.json`);
        import('fs').then(fs => {
            if (fs.existsSync(fp)) {
                res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
            } else {
                res.json({ error: '查無當日歷史紀錄。' });
            }
        });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Weather endpoint
app.post('/api/weather', async (req, res) => {
    const city = req.body.city || '台中市';
    try {
        let weatherRawText = '';
        const cwaKey = process.env.CWA_API_KEY || process.env.CWB_API_KEY;
        
        if (cwaKey) {
            // Fetch 36-hr general weather for Taiwan
            const cwaRes = await fetch(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?Authorization=${cwaKey}`);
            if (cwaRes.ok) {
                const cwaData = await cwaRes.json();
                weatherRawText = "【中央氣象署授權資料】\n" + JSON.stringify(cwaData.records.location);
            }
        }
        
        // Fallback to Tavily if CWA failed or no key
        if (!weatherRawText || weatherRawText.length < 50) {
            const tavRes = await fetch('https://api.tavily.com/search', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: `台灣 ${city} 今日天氣預報與降雨機率`, search_depth: 'basic' })
            });
            const tavData = await tavRes.json();
            weatherRawText = "【Tavily網頁資料】\n" + (tavData.results||[]).map(r=>r.content).join(' ');
        }
        
        const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ contents: [{ parts: [{ text: `請根據以下氣象資料，提取出「${city}」的專屬天氣預報 (約50字內，包含溫度、降雨機率，並給出貼心穿搭或注意事項)：\n` + weatherRawText.substring(0, 50000) }] }] })
        });
        const gemData = await gemRes.json();
        const output = gemData.candidates?.[0]?.content?.parts?.[0]?.text || "天氣產出失敗";
        res.json({ summary: output });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/scrape - Trigger a new scrape
 */
app.post('/api/scrape', async (req, res) => {
  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Override console.log to send SSE
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const sendEvent = (msg) => {
      res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
    };

    console.log = (...args) => {
      const msg = args.join(' ');
      originalLog(msg);
      sendEvent(msg);
    };
    console.error = (...args) => {
      const msg = args.join(' ');
      originalError(msg);
      sendEvent('❌ ' + msg);
    };
    console.warn = (...args) => {
      const msg = args.join(' ');
      originalWarn(msg);
      sendEvent('⚠️ ' + msg);
    };

    const result = await runNewsMaster();

    // Restore console
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;

    res.write(`data: ${JSON.stringify({ type: 'done', result })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/status - Check system status
 */
app.get('/api/status', (req, res) => {
  const hasApify = process.env.APIFY_API_TOKEN && process.env.APIFY_API_TOKEN !== 'your_apify_api_token_here';
  const hasGemini = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here';
  const data = loadLatestResults();

  res.json({
    status: 'online',
    apifyConfigured: hasApify,
    geminiConfigured: hasGemini,
    lastUpdate: data?.timestamp || null,
    articleCount: data?.articles?.length || 0,
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🗞️  Daily News Agent Dashboard`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop\n`);
});
