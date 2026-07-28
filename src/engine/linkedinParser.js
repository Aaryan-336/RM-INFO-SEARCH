// Public LinkedIn Profile HTML Parser using Cheerio
// Input: Raw HTML string
// Output: Normalized JSON schema with zero hallucinations
// Extraction Priority: 1. JSON-LD -> 2. OpenGraph -> 3. Meta tags -> 4. Cheerio HTML DOM

import * as cheerio from 'cheerio';

/**
 * Parses public LinkedIn profile HTML into a normalized JSON structure.
 * @param {string} htmlString - Raw HTML content of LinkedIn profile page
 * @param {string} [fallbackUrl] - Discovered profile URL from search engine discovery
 * @returns {Object} Normalized JSON profile data
 */
export function parsePublicLinkedInHtml(htmlString, fallbackUrl = null) {
  const result = {
    name: null,
    headline: null,
    location: null,
    jobTitle: null,
    company: null,
    profileUrl: fallbackUrl ? normalizeLinkedInUrl(fallbackUrl) : null,
    image: null,
    about: null,
    experience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
    websites: [],
    confidence: 0,
  };

  if (!htmlString || typeof htmlString !== 'string' || htmlString.trim().length === 0) {
    return result;
  }

  const $ = cheerio.load(htmlString);

  let extractedSource = null;

  // ─────────────────────────────────────────────────────────────
  // PRIORITY 1: JSON-LD Structured Data (<script type="application/ld+json">)
  // ─────────────────────────────────────────────────────────────
  const jsonLdScripts = $('script[type="application/ld+json"]');
  jsonLdScripts.each((_, el) => {
    try {
      const content = $(el).html();
      if (!content) return;
      const data = JSON.parse(content);

      // Extract objects if wrapped in @graph or array
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);

      for (const item of items) {
        if (!item) continue;
        const type = item['@type'];

        if (type === 'Person' || type === 'ProfilePage' || (item.name && (item.jobTitle || item.worksFor))) {
          extractedSource = 'JSON-LD';

          const personObj = type === 'ProfilePage' && item.mainEntity ? item.mainEntity : item;

          if (!result.name && personObj.name) result.name = cleanText(personObj.name);

          // Job Title & Company
          if (!result.jobTitle && personObj.jobTitle) {
            result.jobTitle = Array.isArray(personObj.jobTitle) ? personObj.jobTitle[0] : cleanText(personObj.jobTitle);
          }

          if (!result.company && personObj.worksFor) {
            if (typeof personObj.worksFor === 'string') {
              result.company = cleanText(personObj.worksFor);
            } else if (Array.isArray(personObj.worksFor) && personObj.worksFor[0]) {
              result.company = cleanText(personObj.worksFor[0].name || personObj.worksFor[0]);
            } else if (personObj.worksFor.name) {
              result.company = cleanText(personObj.worksFor.name);
            }
          }

          // Headline
          if (!result.headline) {
            if (personObj.description) result.headline = cleanText(personObj.description);
            else if (result.jobTitle && result.company) result.headline = `${result.jobTitle} at ${result.company}`;
            else if (result.jobTitle) result.headline = result.jobTitle;
          }

          // Location
          if (!result.location && personObj.address) {
            if (typeof personObj.address === 'string') {
              result.location = cleanText(personObj.address);
            } else if (personObj.address.addressLocality) {
              const locParts = [personObj.address.addressLocality, personObj.address.addressRegion, personObj.address.addressCountry].filter(Boolean);
              result.location = locParts.join(', ');
            }
          }

          // Profile URL
          if (!result.profileUrl && (personObj.url || personObj.sameAs)) {
            const urlCandidate = personObj.url || (Array.isArray(personObj.sameAs) ? personObj.sameAs[0] : personObj.sameAs);
            if (urlCandidate && typeof urlCandidate === 'string' && urlCandidate.includes('linkedin.com/in/')) {
              result.profileUrl = normalizeLinkedInUrl(urlCandidate);
            }
          }

          // Image URL
          if (!result.image && personObj.image) {
            if (typeof personObj.image === 'string') {
              result.image = personObj.image;
            } else if (personObj.image.contentUrl) {
              result.image = personObj.image.contentUrl;
            } else if (personObj.image.url) {
              result.image = personObj.image.url;
            }
          }

          // SameAs Websites
          if (personObj.sameAs && Array.isArray(personObj.sameAs)) {
            for (const link of personObj.sameAs) {
              if (typeof link === 'string' && !link.includes('linkedin.com') && !result.websites.includes(link)) {
                result.websites.push(link);
              }
            }
          }
        }
      }
    } catch (e) {
      // JSON-LD parse error, skip block
    }
  });

  // ─────────────────────────────────────────────────────────────
  // PRIORITY 2: OpenGraph Meta Tags (<meta property="og:...">)
  // ─────────────────────────────────────────────────────────────
  const ogTitle = getMetaContent($, 'og:title');
  const ogDesc = getMetaContent($, 'og:description');
  const ogImage = getMetaContent($, 'og:image');
  const ogUrl = getMetaContent($, 'og:url');

  if (!result.profileUrl && ogUrl && ogUrl.includes('linkedin.com/in/')) {
    result.profileUrl = normalizeLinkedInUrl(ogUrl);
  }

  if (!result.image && ogImage && !ogImage.includes('static.licdn.com/sc/h/')) {
    result.image = ogImage;
  }

  if (ogTitle) {
    if (!extractedSource) extractedSource = 'OpenGraph';
    const parsedTitle = parseLinkedInTitleString(ogTitle);
    if (parsedTitle) {
      if (!result.name && parsedTitle.name) result.name = parsedTitle.name;
      if (!result.headline && parsedTitle.headline) result.headline = parsedTitle.headline;
      if (!result.jobTitle && parsedTitle.jobTitle) result.jobTitle = parsedTitle.jobTitle;
      if (!result.company && parsedTitle.company) result.company = parsedTitle.company;
    }
  }

  if (!result.headline && ogDesc) {
    result.headline = cleanText(ogDesc);
  }

  // ─────────────────────────────────────────────────────────────
  // PRIORITY 3: Standard Meta Tags (<meta name="...">)
  // ─────────────────────────────────────────────────────────────
  const metaDesc = getMetaContent($, 'description', 'name');
  const metaTitle = getMetaContent($, 'title', 'name') || $('title').text();

  if (!result.headline && metaDesc) {
    result.headline = cleanText(metaDesc);
  }

  if (metaTitle && (!result.name || !result.jobTitle)) {
    if (!extractedSource) extractedSource = 'Meta Tags';
    const parsedTitle = parseLinkedInTitleString(metaTitle);
    if (parsedTitle) {
      if (!result.name && parsedTitle.name) result.name = parsedTitle.name;
      if (!result.headline && parsedTitle.headline) result.headline = parsedTitle.headline;
      if (!result.jobTitle && parsedTitle.jobTitle) result.jobTitle = parsedTitle.jobTitle;
      if (!result.company && parsedTitle.company) result.company = parsedTitle.company;
    }
  }

  // Canonical link tag check
  const canonicalUrl = $('link[rel="canonical"]').attr('href');
  if (!result.profileUrl && canonicalUrl && canonicalUrl.includes('linkedin.com/in/')) {
    result.profileUrl = normalizeLinkedInUrl(canonicalUrl);
  }

  // ─────────────────────────────────────────────────────────────
  // PRIORITY 4: Cheerio HTML DOM Selectors
  // ─────────────────────────────────────────────────────────────

  // Top Card Selectors (Public LinkedIn Profile view)
  if (!result.name) {
    const nameEl = $('.top-card-layout__title, h1.top-card-layout__title, h1.text-heading-xlarge, .pv-top-card--list li').first();
    if (nameEl.length) result.name = cleanText(nameEl.text());
  }

  if (!result.headline) {
    const headlineEl = $('.top-card-layout__headline, h2.top-card-layout__headline, .text-body-medium.break-words').first();
    if (headlineEl.length) result.headline = cleanText(headlineEl.text());
  }

  if (!result.location) {
    const locEl = $('.top-card__subline-item, .top-card-layout__first-subline, .text-body-small.inline.t-black--light').first();
    if (locEl.length) result.location = cleanText(locEl.text());
  }

  if (!result.image) {
    const imgEl = $('img.pv-top-card-profile-picture__image, img.top-card__profile-image, img.ghost-person').first();
    const src = imgEl.attr('src') || imgEl.attr('data-delayed-url');
    if (src && !src.includes('ghost-person') && !src.includes('static.licdn.com/sc/h/')) {
      result.image = src;
    }
  }

  // About Section
  const aboutEl = $('.summary .core-section-container__content, section.summary p, .pv-about-section .pv-about__summary-text').first();
  if (aboutEl.length) {
    result.about = cleanText(aboutEl.text());
  }

  // Experience Items
  const expItems = $(
    '.experience-item, .experience-group, section.experience ul > li, .pv-profile-section.experience-section li, ' +
    'section:has(#experience) ul > li, #experience ~ div ul > li, div#experience ~ div ul > li, ' +
    'section[data-section="experience"] ul > li, .pvs-list__outer-container > ul > li'
  );
  expItems.each((_, el) => {
    const $item = $(el);
    const spans = $item.find('span[aria-hidden="true"]');
    const textParts = spans.map((_, s) => $(s).text().trim()).get().filter(t => t.length > 0);

    let title = cleanText($item.find('.experience-item__title, h3, .profile-section-card__title').first().text());
    let company = cleanText($item.find('.experience-item__subtitle, h4, .profile-section-card__subtitle').first().text());
    let duration = cleanText($item.find('.experience-item__duration, .date-range, .profile-section-card__caption').first().text());
    let location = cleanText($item.find('.experience-item__location, .profile-section-card__meta-item').first().text());
    let description = cleanText($item.find('.experience-item__description, .pv-entity__extra-details').first().text());

    if (!title && textParts.length >= 1) title = textParts[0];
    if (!company && textParts.length >= 2) company = textParts[1];
    if (!duration && textParts.length >= 3) {
      duration = textParts.find(t => /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|present|\d{4}|yr|mo|year|month)/i.test(t)) || null;
    }

    if (title || company) {
      result.experience.push({
        title: title || null,
        company: company || null,
        duration: duration || null,
        location: location || null,
        description: description || null,
      });
    }
  });

  // Education Items
  const eduItems = $('.education-item, section.education ul > li, .pv-profile-section.education-section li');
  eduItems.each((_, el) => {
    const $item = $(el);
    const institution = cleanText($item.find('.education__school-name, h3, .profile-section-card__title').first().text());
    const degree = cleanText($item.find('.education__degree-name, h4, .profile-section-card__subtitle').first().text());
    const fieldOfStudy = cleanText($item.find('.education__field-of-study, .profile-section-card__field').first().text());
    const duration = cleanText($item.find('.date-range, .profile-section-card__caption').first().text());

    if (institution) {
      result.education.push({
        institution: institution || null,
        degree: degree || null,
        fieldOfStudy: fieldOfStudy || null,
        duration: duration || null,
      });
    }
  });

  // Skills
  $('.skills-section li, .pv-skill-category-entity__name').each((_, el) => {
    const skill = cleanText($(el).text());
    if (skill && skill.length < 50 && !result.skills.includes(skill)) {
      result.skills.push(skill);
    }
  });

  // Deduce Job Title and Company if missing from headline
  if (!result.jobTitle || !result.company) {
    if (result.headline && result.headline.includes(' at ')) {
      const parts = result.headline.split(/\s+at\s+/i);
      if (parts.length >= 2) {
        if (!result.jobTitle) result.jobTitle = parts[0].trim();
        if (!result.company) result.company = parts[1].split(/[|•,]/)[0].trim();
      }
    } else if (result.experience.length > 0) {
      if (!result.jobTitle) result.jobTitle = result.experience[0].title;
      if (!result.company) result.company = result.experience[0].company;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SANITIZE AUTHWALL / SIGN UP POLLUTION
  // ─────────────────────────────────────────────────────────────
  if (result.name && (
      result.name.toLowerCase().includes('sign up') || 
      result.name.toLowerCase().includes('log in') || 
      result.name.toLowerCase().includes('join linkedin') ||
      result.name.toLowerCase().includes('linkedin.com') ||
      result.name.toLowerCase().includes('http') ||
      result.name.toLowerCase() === 'linkedin'
  )) {
    result.name = null;
  }

  if (result.headline && (
      result.headline.toLowerCase().includes('750 million') || 
      result.headline.toLowerCase().includes('manage your professional identity') ||
      result.headline.toLowerCase().includes('access knowledge, insights')
  )) {
    result.headline = null;
  }

  if (result.image && (
      result.image.includes('static.licdn.com/sc/h/') || 
      result.image.includes('linkedin-logo') ||
      result.image.includes('ghost')
  )) {
    result.image = null;
  }

  // ─────────────────────────────────────────────────────────────
  // CONFIDENCE SCORE COMPUTATION (0 to 1.0)
  // ─────────────────────────────────────────────────────────────
  let score = 0;
  if (result.name) score += 0.25;
  if (result.headline || (result.jobTitle && result.company)) score += 0.25;
  if (result.profileUrl) score += 0.20;
  if (result.location) score += 0.10;
  if (result.image) score += 0.10;
  if (result.experience.length > 0) score += 0.10;

  result.confidence = Math.min(1.0, parseFloat(score.toFixed(2)));

  return result;
}

// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

function getMetaContent($, property, attribute = 'property') {
  return $(`meta[${attribute}="${property}"]`).attr('content') ||
         $(`meta[${attribute}="${property.toLowerCase()}"]`).attr('content') || null;
}

function cleanText(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeLinkedInUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
  if (match && match[1]) {
    return `https://www.linkedin.com/in/${match[1]}/`;
  }
  return url;
}

function parseLinkedInTitleString(titleString) {
  if (!titleString) return null;

  const lower = titleString.toLowerCase();
  if (lower.includes('sign up') || lower.includes('log in') || lower.includes('join linkedin') || lower.includes('750 million')) {
    return null;
  }

  // Clean " | LinkedIn" suffix
  let title = titleString.replace(/\s*[|–-]\s*(LinkedIn|Profiles?)\.?$/i, '').trim();

  // Typical format: "Name - Headline" or "Name - Job Title at Company"
  const parts = title.split(/\s+-\s+/);
  if (parts.length < 2) return { name: title, headline: null, jobTitle: null, company: null };

  const name = parts[0].trim();
  const headline = parts.slice(1).join(' - ').trim();

  if (name.toLowerCase() === 'sign up' || name.toLowerCase() === 'log in') return null;

  let jobTitle = null;
  let company = null;

  if (headline.includes(' at ')) {
    const atParts = headline.split(/\s+at\s+/i);
    if (atParts.length >= 2) {
      jobTitle = atParts[0].trim();
      company = atParts[1].split(/[|•,]/)[0].trim();
    }
  }

  return { name, headline, jobTitle, company };
}
