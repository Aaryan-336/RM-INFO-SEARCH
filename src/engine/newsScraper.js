// News Mentions & Media Coverage Intelligence Engine
// Scrapes DuckDuckGo News / Google Search for news mentions, press appearances, and article links

import * as cheerio from 'cheerio';
import { CONFIDENCE } from '../utils/confidence.js';

/**
 * Discovers and parses news articles mentioning the target person or company
 */
export async function fetchNewsMentions(identity, logger) {
  const start = Date.now();
  const personName = identity?.normalized?.fullName || '';
  const companyName = identity?.company?.officialName || identity?.company?.normalized || '';
  const firstName = identity?.normalized?.firstName || '';
  const lastName = identity?.normalized?.lastName || '';

  if (!personName && !companyName) {
    logger?.skipped('News Intelligence', 'No person or company name provided');
    return [];
  }

  logger?.running('News Intelligence', `Searching corporate news & press releases for "${companyName}" (Last 30 Days)...`);

  const newsItems = [];
  const seenUrls = new Set();

  const searchQueries = [
    `"${companyName}" news`,
    `"${companyName}" business revenue growth OR funding OR acquisition`,
    `"${companyName}" press release OR announcements`,
  ];

  for (const query of searchQueries) {
    try {
      // df=m restricts DuckDuckGo search results specifically to past month (last 30 days)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&df=m`;
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);

      $('.result').each((_, el) => {
        const titleEl = $(el).find('a.result__a');
        const snippetEl = $(el).find('.result__snippet');
        const urlEl = $(el).find('a.result__url');

        let title = titleEl.text().trim();
        let snippet = snippetEl.text().trim();
        let href = titleEl.attr('href') || urlEl.attr('href') || '';

        if (href.includes('uddg=')) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        }
        if (href.startsWith('//')) href = 'https:' + href;

        if (!href.startsWith('http')) return;

        const cleanUrl = href.split('?')[0].toLowerCase();
        if (seenUrls.has(cleanUrl)) return;
        
        // Skip social network homepages or generic directory roots
        if (cleanUrl.includes('linkedin.com') || cleanUrl.includes('facebook.com') || cleanUrl.includes('twitter.com') || cleanUrl.includes('instagram.com')) return;

        // Verify relevance: STRICTLY REQUIRE COMPANY MENTION (Company News Only)
        const textCombined = `${title} ${snippet}`.toLowerCase();
        const companyCoreWords = (identity?.company?.coreWords || companyName.toLowerCase().split(' ')).filter(w => w.length > 2);
        const mentionsCompany = companyCoreWords.some(word => textCombined.includes(word.toLowerCase()));

        if (mentionsCompany) {
          seenUrls.add(cleanUrl);

          // Infer publisher from domain
          let publisher = 'News Outlet';
          try {
            const domainObj = new URL(href);
            publisher = domainObj.hostname.replace(/^www\./, '').toUpperCase();
            if (publisher.includes('ECONOMIC') || publisher.includes('INDIATIMES')) publisher = 'Economic Times';
            else if (publisher.includes('LIVEMINT') || publisher.includes('MINT')) publisher = 'Mint';
            else if (publisher.includes('MONEYCONTROL')) publisher = 'Moneycontrol';
            else if (publisher.includes('BUSINESS-STANDARD')) publisher = 'Business Standard';
            else if (publisher.includes('FINANCIALEXPRESS')) publisher = 'Financial Express';
            else if (publisher.includes('REUTERS')) publisher = 'Reuters';
            else if (publisher.includes('BLOOMBERG')) publisher = 'Bloomberg';
          } catch {}

          const mentionsPerson = firstName && lastName && textCombined.includes(firstName.toLowerCase()) && textCombined.includes(lastName.toLowerCase());

          newsItems.push({
            title,
            url: href,
            snippet,
            publisher,
            mentionsPerson: !!mentionsPerson,
            mentionsCompany: true,
            timestamp: new Date().toISOString(),
            confidence: 0.90,
          });
        }
      });
    } catch (queryErr) {
      logger?.warning?.('News Intelligence', `News query warning for "${query}": ${queryErr.message}`);
    }
  }

  const duration = Date.now() - start;
  logger?.success('News Intelligence', `Discovered ${newsItems.length} verified news article mention(s)`, { durationMs: duration });

  return newsItems.slice(0, 6); // Return top 6 relevant news mentions
}
