/**
 * Yahoo News Taiwan Scraper
 * Uses Apify RAG Web Browser to scrape Yahoo News TW
 */

const YAHOO_TW_URLS = {
  top: 'https://tw.news.yahoo.com/',
  politics: 'https://tw.news.yahoo.com/politics',
  finance: 'https://tw.news.yahoo.com/finance',
  entertainment: 'https://tw.news.yahoo.com/entertainment',
  sports: 'https://tw.news.yahoo.com/sports',
  technology: 'https://tw.news.yahoo.com/technology',
  world: 'https://tw.news.yahoo.com/world',
};

/**
 * Parse Yahoo TW news from scraped markdown content
 */
function parseYahooMarkdown(markdown, category) {
  const articles = [];
  if (!markdown) return articles;

  // Extract news headlines and links from markdown
  // Yahoo News TW typically renders as linked headlines
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/tw\.news\.yahoo\.com\/[^\s)]+)\)/g;
  let match;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const title = match[1].trim();
    const link = match[2].trim();

    // Filter out navigation / non-article links
    if (
      title.length < 8 ||
      title.includes('更多') ||
      title.includes('Yahoo') ||
      title.includes('登入') ||
      title.includes('首頁') ||
      link.includes('/login') ||
      /^https?:\/\/tw\.news\.yahoo\.com\/?$/.test(link)
    ) {
      continue;
    }

    articles.push({
      source: 'Yahoo TW',
      category,
      title,
      link,
      description: '',
      pubDate: new Date().toISOString(),
      thumbnail: '',
      language: 'zh-TW',
    });
  }

  return articles;
}

/**
 * Scrape Yahoo News TW using Apify
 * @param {string} apifyToken - Apify API token
 * @param {string[]} categories - categories to scrape
 * @param {number} maxPerCategory - max articles per category
 */
export async function scrapeYahooTW(apifyToken, categories = null, maxPerCategory = 8) {
  const selectedCategories = categories || ['top', 'world', 'technology'];
  const allArticles = [];
  const seenLinks = new Set();

  for (const category of selectedCategories) {
    const url = YAHOO_TW_URLS[category];
    if (!url) {
      console.warn(`⚠️ Unknown Yahoo TW category: ${category}`);
      continue;
    }

    try {
      console.log(`📡 Fetching Yahoo TW ${category}...`);

      const response = await fetch(
        'https://api.apify.com/v2/acts/apify~rag-web-browser/run-sync-get-dataset-items?token=' + apifyToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: url,
            maxResults: 1,
            outputFormats: ['markdown'],
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Apify API returned ${response.status}: ${response.statusText}`);
      }

      const results = await response.json();
      const markdown = results?.[0]?.markdown || results?.[0]?.text || '';

      const articles = parseYahooMarkdown(markdown, category);

      // Deduplicate and limit
      const unique = [];
      for (const article of articles) {
        if (!seenLinks.has(article.link) && unique.length < maxPerCategory) {
          seenLinks.add(article.link);
          unique.push(article);
        }
      }

      allArticles.push(...unique);
      console.log(`  ✅ Got ${unique.length} articles from Yahoo TW ${category}`);
    } catch (error) {
      console.error(`  ❌ Failed to fetch Yahoo TW ${category}:`, error.message);
    }
  }

  console.log(`📰 Total Yahoo TW articles: ${allArticles.length}`);
  return allArticles;
}

/**
 * Fallback: Scrape Yahoo TW without Apify (using direct fetch + cheerio)
 */
export async function scrapeYahooTWDirect(categories = null, maxPerCategory = 8) {
  const { load } = await import('cheerio');
  const selectedCategories = categories || ['top', 'world', 'technology'];
  const allArticles = [];
  const seenLinks = new Set();

  for (const category of selectedCategories) {
    const url = YAHOO_TW_URLS[category];
    if (!url) continue;

    try {
      console.log(`📡 Fetching Yahoo TW ${category} (direct)...`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const $ = load(html);

      // Yahoo News TW uses <a> tags with data-test-locator or within stream items
      $('a[href*="/news/"]').each((_, el) => {
        const title = $(el).text().trim();
        let link = $(el).attr('href') || '';

        if (link.startsWith('/')) {
          link = 'https://tw.news.yahoo.com' + link;
        }

        if (
          title.length >= 8 &&
          !seenLinks.has(link) &&
          allArticles.filter((a) => a.category === category).length < maxPerCategory
        ) {
          seenLinks.add(link);
          allArticles.push({
            source: 'Yahoo TW',
            category,
            title,
            link,
            description: '',
            pubDate: new Date().toISOString(),
            thumbnail: '',
            language: 'zh-TW',
          });
        }
      });

      const count = allArticles.filter((a) => a.category === category).length;
      console.log(`  ✅ Got ${count} articles from Yahoo TW ${category}`);
    } catch (error) {
      console.error(`  ❌ Failed to fetch Yahoo TW ${category}:`, error.message);
    }
  }

  console.log(`📰 Total Yahoo TW articles: ${allArticles.length}`);
  return allArticles;
}

export { YAHOO_TW_URLS };
