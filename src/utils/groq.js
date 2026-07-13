/**
 * Shared utility for calling the Groq API with robust automatic fallback
 * to a lightweight model (llama-3.1-8b-instant) if the primary model (llama-3.3-70b-versatile)
 * is rate-limited or hits its quota limits.
 * Includes automatic retry with parsing of backoff delays for 429 rate limit responses.
 */

async function fetchWithRetry(url, fetchOptions, maxRetries = 2, logger, stage) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const res = await fetch(url, fetchOptions);
      if (res.ok) {
        return res;
      }
      
      const status = res.status;
      const errText = await res.text().catch(() => '');
      
      if (status === 429) {
        attempt++;
        if (attempt > maxRetries) {
          throw new Error(`Status 429: ${errText.substring(0, 250)}`);
        }
        
        // Parse Groq retry delay e.g. "please try again in 6.43s" or "try again in 14m49s"
        let delayMs = 3000; // default 3 seconds
        const matchSec = errText.match(/try again in ([\d\.]+)s/i);
        const matchMin = errText.match(/try again in ([\d\.]+)m/i);
        
        if (matchSec) {
          delayMs = Math.ceil(parseFloat(matchSec[1]) * 1000) + 1000; // add a 1s buffer
        } else if (matchMin) {
          delayMs = Math.ceil(parseFloat(matchMin[1]) * 60 * 1000) + 2000;
        }
        
        // If the delay is more than 20 seconds (e.g. daily quota reached), throw immediately to trigger fallback
        if (delayMs > 20000 || attempt > maxRetries) {
          throw new Error(`Status 429: ${errText.substring(0, 250)}`);
        }
        
        if (logger) {
          logger.warning(
            stage || 'Groq',
            `Groq rate limited (429). Retrying in ${(delayMs / 1000).toFixed(1)}s (Attempt ${attempt}/${maxRetries})...`
          );
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      
      throw new Error(`Status ${status}: ${errText.substring(0, 250)}`);
    } catch (err) {
      // If it's a specific HTTP error (other than 429), throw it immediately
      if (err.message.includes('Status') && !err.message.includes('Status 429')) {
        throw err;
      }
      
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }
      
      const delayMs = attempt * 2000;
      if (logger) {
        logger.warning(
          stage || 'Groq',
          `Groq connection failed: ${err.message}. Retrying in ${delayMs / 1000}s (Attempt ${attempt}/${maxRetries})...`
        );
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

export async function callGroqWithFallback(systemContent, userPrompt, options = {}, logger) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not defined');
  }

  const primaryModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const fallbackModel = 'llama-3.1-8b-instant';
  
  const timeoutMs = options.timeout || 12000;
  const temperature = options.temperature ?? 0.1;
  const responseFormat = options.response_format ?? { type: 'json_object' };
  const maxTokens = options.max_tokens;

  const payload = {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userPrompt }
    ],
    temperature,
    response_format: responseFormat
  };
  if (maxTokens) {
    payload.max_tokens = maxTokens;
  }

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: primaryModel,
      ...payload
    }),
    signal: AbortSignal.timeout(timeoutMs)
  };

  // Attempt 1: Primary Model (with retry)
  try {
    const res = await fetchWithRetry(
      'https://api.groq.com/openai/v1/chat/completions',
      fetchOptions,
      2,
      logger,
      options.stage
    );

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    const errMsg = err.message || '';
    const isRateLimit = errMsg.includes('429') || 
                        errMsg.toLowerCase().includes('limit') || 
                        errMsg.toLowerCase().includes('quota') || 
                        errMsg.toLowerCase().includes('rate');

    if (primaryModel === fallbackModel || !isRateLimit) {
      throw err;
    }

    if (logger) {
      logger.warning(
        options.stage || 'Groq', 
        `Groq (${primaryModel}) rate limited or failed: ${err.message}. Retrying with fallback model (${fallbackModel})...`
      );
    }

    // Attempt 2: Fallback Model (with retry)
    const fallbackFetchOptions = {
      ...fetchOptions,
      body: JSON.stringify({
        model: fallbackModel,
        ...payload
      })
    };

    const res = await fetchWithRetry(
      'https://api.groq.com/openai/v1/chat/completions',
      fallbackFetchOptions,
      2,
      logger,
      options.stage
    );

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
}
