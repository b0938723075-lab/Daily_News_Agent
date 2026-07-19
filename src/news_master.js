import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const LINE_CHANNEL_ACCESS_TOKEN = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').replace(/\s+/g, '');
const LINE_USER_ID = (process.env.LINE_USER_ID || '').trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const DASHBOARD_URL = "http://localhost:3000";

// Helper to fetch using Tavily
async function fetchTavily(query, limit) {
    const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: query,
            search_depth: "advanced", // use advanced for better relevance
            topic: "news", // restrict to news
            days: 2, // only recent 2 days to prevent old news
            max_results: limit
        })
    });
    const data = await res.json();
    return data.results || [];
}

// Helper to check for duplicates
function loadPreviousData() {
    const latestFile = path.join(DATA_DIR, 'latest.json');
    if (!fs.existsSync(latestFile)) return new Set();
    try {
        const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
        const seen = new Set();
        (data.articles || []).forEach(a => {
            if (a.link) seen.add(a.link);
            if (a.title) seen.add(a.title);
        });
        return seen;
    } catch {
        return new Set();
    }
}

export async function runNewsMaster() {
  console.log("🚀 啟動 news_master.js - 每日重點新聞特工");
  
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const seenData = loadPreviousData();

  function deduplicate(articles) {
      const filtered = [];
      for (const a of articles) {
          if (!seenData.has(a.url) && !seenData.has(a.title)) {
              filtered.push(a);
              seenData.add(a.url);
              seenData.add(a.title);
          }
      }
      return filtered;
  }

  try {
    console.log("📡 正在透過 Tavily 搜尋精選大分類...");
    const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    console.log("📡 正在透過 Yahoo 奇摩新聞 RSS 抓取最在地的台灣與國際頭條...");
    const parser = new Parser();
    const [domesticRss, intlRss, secondaryRss] = await Promise.all([
        parser.parseURL('https://tw.news.yahoo.com/rss/politics'),
        parser.parseURL('https://tw.news.yahoo.com/rss/world'),
        parser.parseURL('https://tw.news.yahoo.com/rss/society')
    ]);
    
    // 將 RSS 新聞對應到現有變數
    let domesticRaw = domesticRss.items.map(a => ({ title: a.title, url: a.link, content: a.contentSnippet || a.title }));
    let intlRaw = intlRss.items.map(a => ({ title: a.title, url: a.link, content: a.contentSnippet || a.title }));
    let domesticSecondaryRaw = secondaryRss.items.map(a => ({ title: a.title, url: a.link, content: a.contentSnippet || a.title }));
    let intlSecondaryRaw = []; // 若無國外次要則留空
    
    // 氣象署即時資料
    let cwaToday = "無即時氣象", cwaWeekly = "無一週氣象";
    const cwaKey = process.env.CWA_API_KEY || process.env.CWB_API_KEY;
    if (cwaKey) {
        try {
            console.log("☁️ 正在抓取中央氣象署 (CWA) 氣象資料...");
            const res36 = await fetch(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?Authorization=${cwaKey}&locationName=${encodeURIComponent('臺中市')}`);
            if (res36.ok) { let d = await res36.json(); cwaToday = JSON.stringify(d.records.location); }
            
            const res7Days = await fetch(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091?Authorization=${cwaKey}&locationName=${encodeURIComponent('臺中市')}`);
            if (res7Days.ok) { let d = await res7Days.json(); cwaWeekly = JSON.stringify(d.records.locations[0].location); }
        } catch(e) { console.log("⚠️ CWA API 抓取失敗:", e.message); }
    } else {
        const twWeather = await fetchTavily("台中市 今日與一週天氣 紫外線與降雨", 5);
        cwaToday = twWeather.map(r=>r.content).join(' ');
        cwaWeekly = cwaToday;
    }
    
    // Deduplicate and limit to 5
    const domestic = deduplicate(domesticRaw).slice(0, 5);
    const intl = deduplicate(intlRaw).slice(0, 5);
    const domesticSecondary = deduplicate(domesticSecondaryRaw).slice(0, 5);
    const intlSecondary = deduplicate(intlSecondaryRaw).slice(0, 5);
    
    const articlesInfos = [
        ...domestic.map(r => `【國內頭條】Title: ${r.title}\nUrl: ${r.url}\nContent: ${r.content}`),
        ...intl.map(r => `【國際頭條】Title: ${r.title}\nUrl: ${r.url}\nContent: ${r.content}`),
        ...domesticSecondary.map(r => `【國內次要/熱門】Title: ${r.title}\nUrl: ${r.url}\nContent: ${r.content}`),
        ...intlSecondary.map(r => `【國際次要/熱門】Title: ${r.title}\nUrl: ${r.url}\nContent: ${r.content}`)
    ].join('\n\n');

    console.log("🧠 將新聞交給 Gemini 提取摘要並生成歷史過濾資料與一週台中天氣數據...");
    
    // Multi-part objective for Gemini
    const geminiPrompt = `
      請扮演專業且精準的新聞編輯。處理以下資訊並回傳嚴格的 JSON 格式 (不要加上 \`\`\`json 標記，純粹 JSON 解析格式)。
      
      要求結構如下：
      {
         "line_telegram_report": "產生要傳遞到 LINE 的最終文字摘要（String）。排版成【國內重點頭條】與【國外重點頭條】。\\n規則：國內與國外『各嚴格挑選 3 則』。若當天沒有具規模的重點頭條，請改用『次要討論話題高的新聞』補足 3 則。\\n（每則格式：◆ 新聞標題\\n『白話總結』：用最簡單、白話的 1-2 行文字告訴我發生什麼事，讓我不用點進去就知道重點\\n『網頁連結』：...），務必確保新聞絕對不重複且附上連結。",
         "weekly_chart_data": {
            "labels": ["一 (4/6)", "二 (4/7)", "三 (4/8)", "四 (4/9)", "五 (4/10)", "六 (4/11)", "日 (4/12)"], 
            "highs": [30, 31, 29, 28, 30, 32, 29], 
            "lows": [22, 23, 21, 20, 22, 24, 21]
         },
         "translated_articles": [
            { "title": "繁體中文標題", "link": "https...", "description": "1-2 行白話總結", "source": "國內頭條/國際頭條", "tag": "新聞" }
         ]
      }
      
      ⚠️ 新聞過濾權威準則（今天是 ${todayStr}，僅限處理當日新聞，嚴格剔除所有過期舊聞）：
      1. 🔴 全面強制繁體中文翻譯：【非常重要】不管 Tavily 抓回來的新聞是英文還是哪國語言，你在輸出 \`line_telegram_report\` 時，裡面的「每一個字」都必須 100% 翻譯成繁體中文！絕對不允許出現任何一段英文原文！
      2. 【國內外重點各3則】：國內（必須確保是發生在台灣本地的新聞）挑 3 則，國外挑 3 則。沒有大新聞就拿次要話題補。
      3. 【超級白話文】：白話總結必須非常口語、直接，不能有生硬的文言文或新聞術語，讓忙碌的人一秒看懂。
      4. 氣象走勢 labels 請務必幫星期補上精確的「月/日日期」(例如: "一 (4/6)")。溫度務必要換算成亞洲觀看的「攝氏溫度 (°C)」。
      
      ★ 台中氣象參考資料 (CWA 中央氣象署) ★
      近期 36 小時預報: ${cwaToday.substring(0, 1000)}...
      一週天氣趨勢 (含紫外線與溫度走勢): ${cwaWeekly.substring(0, 4000)}...
      
      ★ 新聞參考資料 ★
      ${articlesInfos}
    `;
    
    let geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }] })
    });
    let result = await geminiRes.json();
    let textOut = result.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    textOut = textOut.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let parsedAI = { line_telegram_report: "摘要失敗", weekly_chart_data: { labels: [], highs: [], lows: [] }, translated_articles: [] };
    try { parsedAI = JSON.parse(textOut); } catch (e) {
        console.error("JSON 解析失敗", textOut);
    }
    
    let reportText = parsedAI.line_telegram_report;
    reportText += `\n\n====================\n🌐 觀看儀表板(天氣圖表與選擇城市/歷史查詢)：\n${DASHBOARD_URL}`;
    
    // Save to latest.json using the AI translated articles for the frontend display
    const frontendArticles = parsedAI.translated_articles || [];
    frontendArticles.push({ title: '台中最新氣象 (中央氣象署)', link: 'https://www.cwa.gov.tw/', description: '依據最新中央氣象署API資料產生', source: '天氣預報' });
    
    const latestJson = {
        timestamp: new Date().toISOString(),
        articles: frontendArticles,
        summary: { headline: "今日重點動態", date: new Date().toISOString().split('T')[0] },
        weather_chart: parsedAI.weekly_chart_data
    };
    
    fs.writeFileSync(path.join(DATA_DIR, 'latest.json'), JSON.stringify(latestJson, null, 2));
    // Also save a historical snapshot for the date
    fs.writeFileSync(path.join(DATA_DIR, `history_${latestJson.summary.date}.json`), JSON.stringify(latestJson, null, 2));

    console.log("💬 發送至 LINE...");
    await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
        body: JSON.stringify({ to: LINE_USER_ID, messages: [{ type: "text", text: "今日精選特派簡報 🗞️\n\n" + reportText }] })
    });

    console.log("✈️ 發送至 Telegram...");
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: "今日精選特派簡報 🗞️\n\n" + reportText })
    });

    console.log("✅ 任務圓滿完成！處理結束。");
    return latestJson;
  } catch (err) {
    console.error("❌ 發生錯誤：", err);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runNewsMaster();
}
