'use strict';
/*
 * Air Master Agent.
 *
 * SWAP POINT: replace the body of askAgent() with a real Claude API call later.
 * Keep the signature (message, context) -> Promise<string> so nothing else changes.
 *
 * Example real impl (when ANTHROPIC_API_KEY is set):
 *
 *   const Anthropic = require('@anthropic-ai/sdk');
 *   const client = new Anthropic();
 *   const res = await client.messages.create({
 *     model: 'claude-opus-4-8',
 *     max_tokens: 1024,
 *     system: 'You are the Air Master cargo assistant.',
 *     messages: [{ role: 'user', content: message }],
 *   });
 *   return res.content.map(b => b.text || '').join('');
 */

async function askAgent(message, context = {}) {
  const text = (message || '').trim();
  if (!text) return 'Tell me what you need help with, e.g. a shipment or quote.';

  const who = context.username ? `, ${context.username}` : '';
  return [
    `Air Master Agent (stub)${who}: I received your message —`,
    `"${text}".`,
    `Real AI replies are not wired yet; this is a placeholder so the chat works end to end.`,
    `Set ANTHROPIC_API_KEY and swap the body of askAgent() in agent.js to go live.`,
  ].join(' ');
}

module.exports = { askAgent };
