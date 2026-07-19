/**
 * Gemini AI Module
 * Handles translation (EN→ZH-TW) and summarization
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Call Gemini API
 */
async function callGemini(apiKey, prompt, maxTokens = 2048) {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.3,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Translate English articles to Traditional Chinese
 * @param {Object[]} articles - articles with title, description
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Object[]>} - translated articles
 */
export async function translateArticles(articles, apiKey) {
  const englishArticles = articles.filter((a) => a.language === 'en');
  if (englishArticles.length === 0) return articles;

  console.log(`🌐 Translating ${englishArticles.length} English articles...`);

  // Batch translate for efficiency (groups of 10)
  const batchSize = 10;
  for (let i = 0; i < englishArticles.length; i += batchSize) {
    const batch = englishArticles.slice(i, i + batchSize);
    const prompt = `你是一位專業新聞翻譯員。請將以下英文新聞標題和描述翻譯成繁體中文。
保持新聞的專業語氣，翻譯要自然流暢。

請用以下 JSON 格式回覆，不要加任何 markdown 格式標記：
[
  {"index": 0, "title_zh": "翻譯標題", "description_zh": "翻譯描述"},
  ...
]

要翻譯的新聞：
${batch.map((a, idx) => `[${idx}] 標題: ${a.title}\n描述: ${a.description}`).join('\n\n')}`;

    try {
      const result = await callGemini(apiKey, prompt, 4096);
      // Extract JSON from response
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const translations = JSON.parse(jsonMatch[0]);
        translations.forEach((t) => {
          const article = batch[t.index];
          if (article) {
            article.title_zh = t.title_zh || article.title;
            article.description_zh = t.description_zh || article.description;
          }
        });
      }
    } catch (error) {
      console.error(`  ❌ Translation batch error:`, error.message);
      // Fallback: keep original
      batch.forEach((a) => {
        a.title_zh = a.title;
        a.description_zh = a.description;
      });
    }
  }

  console.log(`  ✅ Translation complete`);
  return articles;
}

/**
 * Generate news summaries
 * @param {Object[]} articles - all articles
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Object>} - summary object
 */
export async function summarizeNews(articles, apiKey) {
  console.log(`📝 Generating news summary...`);

  const bbcArticles = articles.filter((a) => a.source === 'BBC');
  const yahooArticles = articles.filter((a) => a.source === 'Yahoo TW');

  const prompt = `你是一位頂級的新聞分析師。請根據以下今日新聞，生成一份精美的每日新聞摘要報告。

## BBC 國際新聞
${bbcArticles.map((a) => `- ${a.title_zh || a.title}: ${a.description_zh || a.description}`).join('\n')}

## Yahoo 台灣新聞
${yahooArticles.map((a) => `- ${a.title}: ${a.description || '（無描述）'}`).join('\n')}

請用以下 JSON 格式回覆（不要加 markdown 格式標記）：
{
  "date": "今天日期 YYYY-MM-DD",
  "headline": "一句話概括今日最重要的新聞",
  "bbc_summary": "BBC 國際新聞的 3-5 句摘要，涵蓋最重要的趨勢和事件",
  "yahoo_summary": "Yahoo 台灣新聞的 3-5 句摘要，涵蓋最重要的本地新聞",
  "key_topics": ["關鍵主題1", "關鍵主題2", "關鍵主題3", "關鍵主題4", "關鍵主題5"],
  "sentiment": "positive/neutral/negative",
  "sentiment_note": "整體新聞情緒的一句話說明"
}`;

  try {
    const result = await callGemini(apiKey, prompt, 2048);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const summary = JSON.parse(jsonMatch[0]);
      console.log(`  ✅ Summary generated`);
      return summary;
    }
    throw new Error('No JSON in response');
  } catch (error) {
    console.error(`  ❌ Summary error:`, error.message);
    return {
      date: new Date().toISOString().split('T')[0],
      headline: '每日新聞摘要',
      bbc_summary: `共收集 ${bbcArticles.length} 則 BBC 新聞。`,
      yahoo_summary: `共收集 ${yahooArticles.length} 則 Yahoo 台灣新聞。`,
      key_topics: [],
      sentiment: 'neutral',
      sentiment_note: '自動摘要生成失敗，請查看個別新聞。',
    };
  }
}

export { callGemini };
