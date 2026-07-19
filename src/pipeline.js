/**
 * News Pipeline
 * Orchestrates: Scrape → Translate → Summarize → Store
 */
import { scrapeBBC } from './scrapers/bbc.js';
import { scrapeYahooTW, scrapeYahooTWDirect } from './scrapers/yahoo-tw.js';
import { translateArticles, summarizeNews } from './ai/gemini.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

/**
 * Run the full news pipeline
 */
export async function runPipeline(config = {}) {
  const {
    apifyToken = process.env.APIFY_API_TOKEN,
    geminiKey = process.env.GEMINI_API_KEY,
    bbcCategories = ['top', 'world', 'technology', 'business'],
    yahooCategoriesTW = ['top', 'world', 'technology'],
    maxPerCategory = 5,
  } = config;

  console.log('═══════════════════════════════════════');
  console.log('🗞️  Daily News Agent - Pipeline Start');
  console.log(`📅  ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  console.log('═══════════════════════════════════════\n');

  const result = {
    timestamp: new Date().toISOString(),
    articles: [],
    summary: null,
    errors: [],
  };

  // ─── Step 1: Scrape BBC ───
  console.log('▸ Step 1/4: Scraping BBC News...');
  try {
    const bbcArticles = await scrapeBBC(bbcCategories, maxPerCategory);
    result.articles.push(...bbcArticles);
  } catch (error) {
    console.error('BBC scraping failed:', error.message);
    result.errors.push({ step: 'bbc_scrape', error: error.message });
  }

  // ─── Step 2: Scrape Yahoo TW ───
  console.log('\n▸ Step 2/4: Scraping Yahoo News TW...');
  try {
    let yahooArticles;
    if (apifyToken && apifyToken !== 'your_apify_api_token_here') {
      yahooArticles = await scrapeYahooTW(apifyToken, yahooCategoriesTW, maxPerCategory);
    } else {
      console.log('  ℹ️  No Apify token, using direct scraping...');
      yahooArticles = await scrapeYahooTWDirect(yahooCategoriesTW, maxPerCategory);
    }
    result.articles.push(...yahooArticles);
  } catch (error) {
    console.error('Yahoo TW scraping failed:', error.message);
    result.errors.push({ step: 'yahoo_scrape', error: error.message });
  }

  // ─── Step 3: Translate ───
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    console.log('\n▸ Step 3/4: Translating English articles...');
    try {
      result.articles = await translateArticles(result.articles, geminiKey);
    } catch (error) {
      console.error('Translation failed:', error.message);
      result.errors.push({ step: 'translate', error: error.message });
    }

    // ─── Step 4: Summarize ───
    console.log('\n▸ Step 4/4: Generating summary...');
    try {
      result.summary = await summarizeNews(result.articles, geminiKey);
    } catch (error) {
      console.error('Summary failed:', error.message);
      result.errors.push({ step: 'summarize', error: error.message });
    }
  } else {
    console.log('\n⚠️  No Gemini API key - skipping translation & summary');
    result.summary = {
      date: new Date().toISOString().split('T')[0],
      headline: '每日新聞已抓取完成（未啟用 AI 翻譯摘要）',
      bbc_summary: `共收集 ${result.articles.filter((a) => a.source === 'BBC').length} 則 BBC 新聞。`,
      yahoo_summary: `共收集 ${result.articles.filter((a) => a.source === 'Yahoo TW').length} 則 Yahoo 台灣新聞。`,
      key_topics: [],
      sentiment: 'neutral',
      sentiment_note: '請設定 GEMINI_API_KEY 以啟用翻譯與摘要功能。',
    };
  }

  // ─── Save results ───
  saveResults(result);

  console.log('\n═══════════════════════════════════════');
  console.log(`✅ Pipeline complete!`);
  console.log(`   📰 Articles: ${result.articles.length}`);
  console.log(`   ❌ Errors: ${result.errors.length}`);
  console.log('═══════════════════════════════════════');

  return result;
}

/**
 * Save pipeline results to data directory
 */
function saveResults(result) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const dateStr = new Date().toISOString().split('T')[0];

  // Save latest result
  writeFileSync(
    join(DATA_DIR, 'latest.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  );

  // Save daily archive
  writeFileSync(
    join(DATA_DIR, `${dateStr}.json`),
    JSON.stringify(result, null, 2),
    'utf-8'
  );

  console.log(`  💾 Results saved to data/latest.json & data/${dateStr}.json`);
}

/**
 * Load latest results from data directory
 */
export function loadLatestResults() {
  const latestFile = join(DATA_DIR, 'latest.json');
  if (existsSync(latestFile)) {
    return JSON.parse(readFileSync(latestFile, 'utf-8'));
  }
  return null;
}
