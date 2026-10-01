import assert from 'node:assert/strict';
import { normalizeJobId, validJobId, normalizeSymbolInput, normalizeSymbolList } from '../netlify/lib/input.mjs';
import { documentedFallbackChains, resolveModelForProvider } from '../netlify/lib/llm.mjs';
import { readFileSync } from 'node:fs';

const uuid='123e4567-e89b-42d3-a456-426614174000';
assert.equal(normalizeJobId(uuid),uuid);
assert.equal(validJobId(uuid),true);
assert.throws(()=>normalizeJobId('../jobs/evil'),/INVALID_JOB_ID/);
assert.equal(normalizeSymbolInput(' brk.b '),'BRK.B');
assert.throws(()=>normalizeSymbolInput('../../x'),/INVALID_SYMBOL/);
assert.deepEqual(normalizeSymbolList(['aapl','AAPL','spy','bad symbol']),['AAPL','SPY']);

const chains=documentedFallbackChains();
assert.deepEqual(chains.chat,['openai','gemini','anthropic']);
assert.deepEqual(chains.coach_verify,['gemini','anthropic','openai']);
assert.equal(resolveModelForProvider('openai','chat'),'gpt-5.6-luna');
assert.equal(resolveModelForProvider('openai','deep'),'gpt-5.6-terra');
assert.equal(resolveModelForProvider('openai','final_gate'),'gpt-5.6-sol');
assert.equal(resolveModelForProvider('gemini','coach_verify'),'gemini-2.5-flash');
assert.equal(resolveModelForProvider('anthropic','coach_verify'),'claude-haiku-4-5');

const chat=readFileSync(new URL('../netlify/functions/ai-chat.mjs',import.meta.url),'utf8');
const login=readFileSync(new URL('../netlify/functions/auth-login.mjs',import.meta.url),'utf8');
assert.match(chat,/consumeWorkflowBudget\('coach'/);
assert.match(login,/rateLimit:\{windowLimit:(?:[1-9]|10),windowSize:60/);
assert.match(chat,/MAX_QUESTION_CHARS/);

const health=readFileSync(new URL('../netlify/functions/provider-health.mjs',import.meta.url),'utf8');
const netlify=readFileSync(new URL('../netlify.toml',import.meta.url),'utf8');
assert.match(health,/providerCredentialMode\(provider\)==='netlify_gateway'/);
assert.doesNotMatch(health,/\|\|\s*gatewayConfigured\(\)/);
assert.match(netlify,/Content-Security-Policy/);
assert.match(netlify,/Strict-Transport-Security/);
console.log('hardening-v7.2 tests PASS');
