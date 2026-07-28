// AI Briefing Module
// Uses Groq API (free tier: 30 RPM, 14,400 requests/day)
// Model: Llama 3.3 70B (fast, free, high quality) with automatic Llama 3.1 8B fallback
// Fallback: rule-based structured summary if no API key

import { callGroqWithFallback } from '../utils/groq.js';

export async function generateBriefing(identity, validatedContacts, mcaData, allProfiles, logger) {
  const start = Date.now();
  logger.running('AI Briefing', 'Generating RM intelligence brief');

  const context = buildContext(identity, validatedContacts, mcaData, allProfiles);

  let briefing;

  if (process.env.GROQ_API_KEY) {
    try {
      briefing = await generateWithGroq(context, logger);
    } catch (err) {
      logger.warning('AI Briefing', `Groq API error: ${err.message} — using rule-based fallback`);
      briefing = generateRuleBased(context);
    }
  } else if (process.env.GEMINI_API_KEY) {
    try {
      briefing = await generateWithGemini(context, logger);
    } catch (err) {
      logger.warning('AI Briefing', `Gemini API error: ${err.message} — using rule-based fallback`);
      briefing = generateRuleBased(context);
    }
  } else {
    logger.running('AI Briefing', 'No AI API key — using rule-based analysis');
    briefing = generateRuleBased(context);
  }
  const duration = Date.now() - start;
  logger.success('AI Briefing', `Generated ${briefing.talkingPoints.length} talking points`, { durationMs: duration });

  return briefing;
}

const BRIEFING_PROMPT = `You are a Senior Private Wealth & HNI/UHNI Relationship Manager intelligence analyst for a top-tier private bank and wealth management institution.

Given the following aggregated intelligence about a High-Net-Worth / Executive business contact, generate a comprehensive Private Banking RM Briefing.

INTELLIGENCE COLLECTED:
{CONTEXT}

Generate a JSON response with exactly this structure:
{
  "experienceSummary": "One-line executive summary of the person's professional background, primary directorships, and current role",
  "wealthTierAndCorporateFootprint": "Summary of corporate scale, directorships (DIN), paid-up capital of primary companies, and estimated net-worth tier indicator",
  "talkingPoints": [
    "Point 1 — Specific, actionable private wealth / business talking point for an RM meeting",
    "Point 2",
    "Point 3",
    "Point 4",
    "Point 5"
  ],
  "industryContext": "Key industry dynamics, sector trends, or regulatory developments relevant to the target's business domain",
  "relationshipOpportunities": "Specific high-value wealth management pitch hooks (e.g., Family Office advisory, Liquidity events, Succession planning, Real estate financing, Corporate treasury management)",
  "riskSignals": "Any corporate risk signals, legal compliance warnings, or directorship flags (or 'None identified' if clean)"
}

Rules:
- Maximum 5 talking points.
- Talking points MUST be tailored for a Private Wealth / HNI Relationship Manager meeting.
- Highlight any corporate directorships, capital scale, angel investments, or property holdings found in the intelligence.
- Base everything ONLY on the provided intelligence — do not fabricate figures or facts.
- Return ONLY the JSON object, no markdown fences or extra text.`;

// ── Groq (Free, Fast — Llama 3.3 70B) ────────────────────

async function generateWithGroq(context, logger) {
  const prompt = BRIEFING_PROMPT.replace('{CONTEXT}', JSON.stringify(context, null, 2));

  const text = await callGroqWithFallback(
    'You are an expert RM intelligence analyst. Respond with valid JSON only.',
    prompt,
    {
      temperature: 0.3,
      max_tokens: 1024,
      timeout: 15000,
      stage: 'AI Briefing'
    },
    logger
  );

  return parseAIResponse(text, 'AI Analysis (Groq)', logger);
}

// ── Gemini (fallback) ─────────────────────────────────────

async function generateWithGemini(context, logger) {
  logger.running('AI Briefing', 'Calling Gemini API...');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = BRIEFING_PROMPT.replace('{CONTEXT}', JSON.stringify(context, null, 2));
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  return parseAIResponse(text, 'AI Analysis (Gemini)', logger);
}

// ── Parse AI Response ─────────────────────────────────────

function parseAIResponse(text, source, logger) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        experienceSummary: parsed.experienceSummary || '',
        talkingPoints: parsed.talkingPoints || [],
        industryContext: parsed.industryContext || '',
        relationshipOpportunities: parsed.relationshipOpportunities || '',
        riskSignals: parsed.riskSignals || 'None identified',
        source,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (e) {
    logger.warning('AI Briefing', `Failed to parse AI response — using rule-based fallback`);
  }

  return null;
}

// ── Rule-Based Fallback ───────────────────────────────────

function generateRuleBased(context) {
  const talkingPoints = [];
  const { person, company, directors, roles } = context;

  if (roles.length > 0) {
    const topRole = roles[0];
    talkingPoints.push(`Currently serves as ${topRole} at ${company.name} — discuss current responsibilities and strategic priorities.`);
  } else {
    talkingPoints.push(`Associated with ${company.name} — explore current role and responsibilities.`);
  }

  if (company.industry) {
    talkingPoints.push(`Company operates in ${company.industry} — discuss industry-specific financial needs and market outlook.`);
  }

  if (company.incorporationDate) {
    const years = new Date().getFullYear() - new Date(company.incorporationDate).getFullYear();
    if (years > 10) {
      talkingPoints.push(`${company.name} has been established for ${years}+ years — explore expansion plans and wealth management needs.`);
    } else {
      talkingPoints.push(`${company.name} incorporated ${years} years ago — discuss growth trajectory and funding requirements.`);
    }
  }

  if (directors.length > 0) {
    talkingPoints.push(`Board includes ${directors.length} director(s) — potential for cross-referral opportunities within the director network.`);
  }

  if (company.authorizedCapital || company.paidUpCapital) {
    talkingPoints.push(`Review company's capital structure for potential treasury and investment advisory services.`);
  }

  while (talkingPoints.length < 5) {
    const fillers = [
      'Explore personal wealth management and investment portfolio needs.',
      'Discuss potential synergies between personal and corporate banking requirements.',
      'Inquire about succession planning and next-generation wealth transfer strategies.',
      'Explore insurance and risk management coverage for both personal and business assets.',
      'Discuss international banking needs and cross-border transaction requirements.',
    ];
    const filler = fillers[talkingPoints.length - 1] || fillers[0];
    if (!talkingPoints.includes(filler)) talkingPoints.push(filler);
  }

  return {
    experienceSummary: roles.length > 0
      ? `${person.fullName} serves as ${roles[0]} at ${company.name}.`
      : `${person.fullName} is associated with ${company.name}.`,
    talkingPoints: talkingPoints.slice(0, 5),
    industryContext: company.industry
      ? `${company.name} operates in the ${company.industry} sector.`
      : 'Industry classification not available from public records.',
    relationshipOpportunities: directors.length > 0
      ? `Director network of ${directors.length} individuals presents cross-referral opportunities.`
      : 'Explore opportunities through direct engagement.',
    riskSignals: 'None identified from available public records.',
    source: 'Rule-Based Analysis',
    timestamp: new Date().toISOString(),
  };
}

function buildContext(identity, validatedContacts, mcaData, allProfiles) {
  const roles = [];
  if (validatedContacts.roles) {
    roles.push(...validatedContacts.roles.map(r => r.value));
  }
  if (allProfiles) {
    for (const p of allProfiles) {
      if (p.title) roles.push(p.title);
    }
  }

  return {
    person: {
      fullName: identity.normalized.fullName,
      firstName: identity.normalized.firstName,
      lastName: identity.normalized.lastName,
    },
    company: {
      name: mcaData?.company?.companyName || identity.company.normalized,
      cin: mcaData?.company?.cin,
      status: mcaData?.company?.status,
      type: mcaData?.company?.companyType,
      industry: mcaData?.company?.industry,
      incorporationDate: mcaData?.company?.incorporationDate,
      registeredAddress: mcaData?.company?.registeredAddress,
      authorizedCapital: mcaData?.company?.authorizedCapital,
      paidUpCapital: mcaData?.company?.paidUpCapital,
    },
    roles: [...new Set(roles)],
    directors: (mcaData?.directors || []).map(d => ({
      name: d.name,
      designation: d.designation || d.position,
    })),
    contactsFound: {
      phones: (validatedContacts.phones || []).length,
      emails: (validatedContacts.emails || []).length,
    },
  };
}
