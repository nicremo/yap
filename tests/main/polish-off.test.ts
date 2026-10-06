import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/secrets', () => ({
  getGroqApiKey: () => 'gsk_test',
  isGroqKeySet: () => true,
}));

import { createDefaultSettings } from '../../src/main/defaults';
import { polish } from '../../src/main/dictation/pipeline';
import { setGroqTransport } from '../../src/main/groq';

afterEach(() => {
  setGroqTransport(async () => {
    throw new Error('transport not configured');
  });
});

describe('Off in Style', () => {
  it('sends nothing to Groq and returns the text exactly as transcribed', async () => {
    let requests = 0;
    setGroqTransport(async () => {
      requests += 1;
      return new Response('{}', { status: 200 });
    });
    const settings = { ...createDefaultSettings(), enhancementEnabled: false };

    const result = await polish({
      settings,
      text: 'äh hallo welt',
      styleMode: 'conversation',
      enhancementLevel: 'high',
      dictionary: [],
      corrections: [],
    });

    expect(result).toEqual({ text: 'äh hallo welt', durationMs: null });
    expect(requests).toBe(0);
  });

  it('polishes with the level and style it is given when on', async () => {
    let body: { messages?: Array<{ role: string; content: string }> } = {};
    setGroqTransport(async (_url, init) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Hallo Welt.' }, finish_reason: 'stop' }] }), { status: 200 });
    });
    const settings = { ...createDefaultSettings(), enhancementEnabled: true };

    const coding = await polish({ settings, text: 'hallo welt', styleMode: 'vibe-coding', enhancementLevel: 'high', dictionary: [], corrections: [] });
    const codingPrompt = body.messages?.[0].content ?? '';
    await polish({ settings, text: 'hallo welt', styleMode: 'conversation', enhancementLevel: 'high', dictionary: [], corrections: [] });
    const conversationPrompt = body.messages?.[0].content ?? '';

    expect(coding.text).toBe('Hallo Welt.');
    // An app rule's style reaches the model as a different system prompt.
    expect(codingPrompt).not.toBe(conversationPrompt);
  });
});
