const REWRITE_TIMEOUT_MS = 30_000;

function buildChatUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/v1/chat/completions`;
}

function stripThinkingTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim();
}

function cleanRewriteOutput(content: string | undefined, rawText: string): string {
  const trimmed = stripThinkingTags(content ?? '').trim();
  if (!trimmed) {
    return rawText;
  }

  const stripped =
    trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1).trim()
      : trimmed.startsWith("'") && trimmed.endsWith("'")
        ? trimmed.slice(1, -1).trim()
        : trimmed;

  const metaLeadPattern =
    /^(sure|here(?:'s| is)|rewritten|revised|updated|i changed|i rewrote|i made|this is)/i;

  if (!metaLeadPattern.test(stripped)) {
    return stripped;
  }

  const colonIndex = stripped.indexOf(':');
  if (colonIndex >= 0) {
    const afterColon = stripped.slice(colonIndex + 1).trim();
    if (afterColon) {
      return afterColon;
    }
  }

  return stripped;
}

export async function rewriteWithCloud(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  rawText: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REWRITE_TIMEOUT_MS);

  try {
    const response = await fetch(buildChatUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              'Rewrite the dictated text below.',
              'If the speaker corrected themselves or changed their mind, use only their final intent.',
              'Reply with only the final rewritten text — no preface, explanation, labels, or quotation marks.',
              '',
              '<dictation>',
              rawText,
              '</dictation>',
            ].join('\n'),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cloud rewrite failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    return cleanRewriteOutput(content, rawText);
  } finally {
    clearTimeout(timeout);
  }
}
