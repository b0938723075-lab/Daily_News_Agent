/**
 * BBC News Scraper
 * Uses RSS feeds to fetch latest BBC news articles
 */
import Parser from 'rss-parser';

const BBC_FEEDS = {
  top: 'https://feeds.bbci.co.uk/news/rss.xml',
  world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
};

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'DailyNewsAgent/1.0',
    'Accept': 'application/rss+xml, application/xml, text/xml',
  },
  customFields: {
    item: [['media:thumbnail', 'thumbnail']],
  },
});

/**
 * Scrape BBC News from RSS feeds
 * @param {string[]} categories - categories to scrape (default: all)
 * @param {number} maxPerCategory - max articles per category
 * @returns {Promise<Object[]>} - array of article objects
 */
export async function scrapeBBC(categories = null, maxPerCategory = 5) {
  const selectedCategories = categories || Object.keys(BBC_FEEDS);
  const allArticles = [];
  const seenLinks = new Set();

  for (const category of selectedCategories) {
    const feedUrl = BBC_FEEDS[category];
    if (!feedUrl) {
      console.warn(`⚠️ Unknown BBC category: ${category}`);
      continue;
    }

    try {
      console.log(`📡 Fetching BBC ${category}...`);
      const feed = await parser.parseURL(feedUrl);

      const articles = feed.items.slice(0, maxPerCategory).map((item) => {
        // Deduplicate
        if (seenLinks.has(item.link)) return null;
        seenLinks.add(item.link);

        return {
          source: 'BBC',
          category,
          title: item.title || '',
          link: item.link || '',
          description: item.contentSnippet || item.content || '',
          pubDate: item.isoDate || item.pubDate || '',
          thumbnail: item.thumbnail?.$.url || '',
          language: 'en',
        };
      }).filter(Boolean);

      allArticles.push(...articles);
      console.log(`  ✅ Got ${articles.length} articles from BBC ${category}`);
    } catch (error) {
      console.error(`  ❌ Failed to fetch BBC ${category}:`, error.message);
    }
  }

  console.log(`📰 Total BBC articles: ${allArticles.length}`);
  return allArticles;
}

export { BBC_FEEDS };
