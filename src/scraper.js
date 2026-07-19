/**
 * CLI Scraper Entry Point
 * Run: node src/scraper.js
 */
import { config } from 'dotenv';
import { runPipeline } from './pipeline.js';

config();

console.log('🚀 Starting Daily News Agent...\n');

runPipeline()
  .then((result) => {
    console.log('\n📊 Final Report:');
    if (result.summary) {
      console.log(`  📌 ${result.summary.headline}`);
      console.log(`  🌍 BBC: ${result.summary.bbc_summary}`);
      console.log(`  🇹🇼 Yahoo TW: ${result.summary.yahoo_summary}`);
      if (result.summary.key_topics?.length) {
        console.log(`  🏷️  Topics: ${result.summary.key_topics.join(', ')}`);
      }
    }
  })
  .catch((error) => {
    console.error('❌ Pipeline failed:', error);
    process.exit(1);
  });
