/**
 * Daily News Agent – Frontend App
 */

let currentData = null;
let currentFilter = 'all';

// ─── Init ───
document.addEventListener('DOMContentLoaded', async () => {
  await checkStatus();
  await loadNews();
});

// ─── Check System Status ───
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const status = await res.json();

    const dot = document.getElementById('statusIndicator');
    if (status.status === 'online') {
      dot.className = 'status-dot';
      dot.title = `線上 | Apify: ${status.apifyConfigured ? '✅' : '❌'} | Gemini: ${status.geminiConfigured ? '✅' : '❌'}`;
    } else {
      dot.className = 'status-dot offline';
    }
  } catch {
    document.getElementById('statusIndicator').className = 'status-dot offline';
  }
}

// ─── Load News Data ───
async function loadNews() {
  try {
    const res = await fetch('/api/news');
    const data = await res.json();

    if (!data.timestamp || !data.articles?.length) {
      showEmptyState();
      return;
    }

    currentData = data;
    renderDashboard(data);
  } catch (error) {
    console.error('Failed to load news:', error);
    showEmptyState();
  }
}

// ─── Render Dashboard ───
function renderDashboard(data) {
  // Hide empty state
  document.getElementById('emptyState').classList.add('hidden');

  // ── Summary ──
  if (data.summary) {
    const section = document.getElementById('summarySection');
    section.classList.remove('hidden');

    document.getElementById('headline').textContent = data.summary.headline || '每日新聞摘要';
    document.getElementById('summaryDate').textContent = data.summary.date || '';
    document.getElementById('bbcSummary').textContent = data.summary.bbc_summary || '';
    document.getElementById('yahooSummary').textContent = data.summary.yahoo_summary || '';

    // Sentiment
    const badge = document.getElementById('sentimentBadge');
    const sentiment = data.summary.sentiment || 'neutral';
    badge.className = `sentiment-badge ${sentiment}`;
    const sentMap = { positive: '😊 正面', negative: '😟 負面', neutral: '😐 中性' };
    badge.textContent = sentMap[sentiment] || sentiment;
    badge.title = data.summary.sentiment_note || '';

    // Topics
    const topicsList = document.getElementById('topicsList');
    topicsList.innerHTML = '';
    (data.summary.key_topics || []).forEach((topic) => {
      const tag = document.createElement('span');
      tag.className = 'topic-tag';
      tag.textContent = topic;
      topicsList.appendChild(tag);
    });
  }

  // ── Stats ──
  const bbcCount = data.articles.filter((a) => a.source === 'BBC').length;
  const yahooCount = data.articles.filter((a) => a.source === 'Yahoo TW').length;

  document.getElementById('statTotal').textContent = data.articles.length;
  document.getElementById('statBBC').textContent = bbcCount;
  document.getElementById('statYahoo').textContent = yahooCount;

  if (data.timestamp) {
    const d = new Date(data.timestamp);
    document.getElementById('statUpdate').textContent = d.toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Taipei',
    });
  }

  document.getElementById('statsBar').classList.remove('hidden');
  document.getElementById('filterSection').classList.remove('hidden');
  document.getElementById('articlesSection').classList.remove('hidden');

  // Render Weather Chart
  if (typeof renderWeatherChart === 'function') {
      renderWeatherChart(data.weather_chart);
  }

  // ── Articles ──
  renderArticles(data.articles);
}

// ─── Render Articles ───
function renderArticles(articles) {
  const grid = document.getElementById('articlesGrid');
  grid.innerHTML = '';

  const filtered = currentFilter === 'all'
    ? articles
    : articles.filter((a) => a.source === currentFilter);

  if (filtered.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">沒有符合的新聞。</p>';
    return;
  }

  filtered.forEach((article, i) => {
    const card = document.createElement('a');
    card.className = 'article-card';
    card.href = article.link;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.style.animationDelay = `${i * 0.06}s`;

    const sourceLabel = article.source || '新聞';
    // Dynamically choose style class based on category
    let sourceClass = 'bbc';
    if (sourceLabel.includes('國內')) sourceClass = 'yahoo';
    if (sourceLabel.includes('熱門')) sourceClass = 'bbc';
    if (sourceLabel.includes('天氣')) sourceClass = 'yahoo';
    if (sourceLabel.includes('其他')) sourceClass = 'bbc';

    // Use translated title if available
    const title = article.title_zh || article.title;
    const desc = article.description_zh || article.description || '';

    // Format date
    let dateStr = '';
    if (article.pubDate) {
      try {
        const d = new Date(article.pubDate);
        dateStr = d.toLocaleDateString('zh-TW', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          timeZone: 'Asia/Taipei',
        });
      } catch { dateStr = ''; }
    } else {
        dateStr = new Date().toLocaleDateString('zh-TW');
    }

    card.innerHTML = `
      <div class="card-content">
        <span class="article-source ${sourceClass}">${sourceLabel}</span>
        <h3>${escapeHtml(title)}</h3>
        ${desc ? `<p class="description">${escapeHtml(desc)}</p>` : ''}
        <div class="card-footer">
          <span>${dateStr}</span>
          <span class="arrow-icon">→</span>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

// ─── Filter Articles ───
function filterArticles(filter, btn) {
  currentFilter = filter;

  // Update active button
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (currentData?.articles) {
    renderArticles(currentData.articles);
  }
}

// ─── Trigger Scrape ───
async function triggerScrape() {
  const btn = document.getElementById('btnScrape');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('span').textContent = '抓取中...';

  const dot = document.getElementById('statusIndicator');
  dot.className = 'status-dot loading';

  // Show log section
  const logSection = document.getElementById('logSection');
  logSection.classList.remove('hidden');
  const logOutput = document.getElementById('logOutput');
  logOutput.innerHTML = '';

  function addLog(message) {
    const line = document.createElement('div');
    line.className = 'log-line';

    if (message.includes('✅')) line.classList.add('success');
    else if (message.includes('❌')) line.classList.add('error');
    else if (message.includes('📡') || message.includes('🌐') || message.includes('📝')) line.classList.add('info');

    line.textContent = message;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  try {
    addLog('🚀 啟動新聞抓取管線...');

    const res = await fetch('/api/scrape', { method: 'POST' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'log') {
              addLog(event.message);
            } else if (event.type === 'done') {
              addLog('✅ 管線執行完成！');
              currentData = event.result;
              renderDashboard(event.result);
            } else if (event.type === 'error') {
              addLog(`❌ 錯誤: ${event.message}`);
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch (error) {
    addLog(`❌ 連線錯誤: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = '立即抓取';
    dot.className = 'status-dot';
  }
}

// ─── Close Log ───
function closeLog() {
  document.getElementById('logSection').classList.add('hidden');
}

// ─── Show Empty State ───
function showEmptyState() {
  document.getElementById('emptyState').classList.remove('hidden');
  document.getElementById('summarySection').classList.add('hidden');
  document.getElementById('statsBar').classList.add('hidden');
  document.getElementById('filterSection').classList.add('hidden');
  document.getElementById('articlesSection').classList.add('hidden');
}

// ─── Utility: Escape HTML ───
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── History Query ───
async function queryHistory() {
  const date = document.getElementById('historyDate').value;
  const resultDiv = document.getElementById('historyResult');
  
  if (!date) {
    resultDiv.innerHTML = '<span style="color:#ef4444;">⚠️ 請先選擇想要查詢的日期</span>';
    return;
  }
  
  resultDiv.innerHTML = `<span>⏳ 正在載入 ${date} 的報告...</span>`;
  try {
     const res = await fetch(`/api/history/${date}`);
     const data = await res.json();
     if(data.error) {
         resultDiv.innerHTML = `<span style="color:#ef4444;">❌ ${data.error}</span>`;
     } else {
         resultDiv.innerHTML = `<span style="color:#22c55e;">✅ 成功載入歷史紀錄：${date}</span>`;
         currentData = data;
         renderDashboard(data);
     }
  } catch(e) {
      resultDiv.innerHTML = `<span style="color:#ef4444;">❌ 連線失敗</span>`;
  }
}

// ─── City Weather Query ───
async function queryCityWeather() {
  const city = document.getElementById('cityInput').value;
  const resultDiv = document.getElementById('cityWeatherResult');
  if(!city) {
      resultDiv.innerHTML = '請輸入城市名稱。';
      return;
  }
  resultDiv.innerHTML = '⏳ 正在查詢最新氣象預報...';
  try {
      const res = await fetch('/api/weather', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({city})
      });
      const data = await res.json();
      if(data.error) throw new Error(data.error);
      resultDiv.innerHTML = `<div><strong>✅ ${escapeHtml(city)}：</strong> ${escapeHtml(data.summary)}</div>`;
  } catch(e) {
      resultDiv.innerHTML = `<span style="color:#ef4444;">❌ 查詢失敗</span>`;
  }
}

// ─── Weather Chart Rendering ───
let chartInstance = null;
function renderWeatherChart(weatherData) {
    const section = document.getElementById('weatherSpecial');
    if (!weatherData || !weatherData.labels || weatherData.labels.length === 0) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('weatherChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: weatherData.labels,
            datasets: [
                {
                    label: '最高溫 (°C)',
                    data: weatherData.highs,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: '最低溫 (°C)',
                    data: weatherData.lows,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { labels: { color: '#cbd5e1' } }
            },
            scales: {
                x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.1)' } }
            }
        }
    });
}
