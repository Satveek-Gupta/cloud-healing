'use strict';

/**
 * services/ai.js
 * LLM integration for the SelfHeal healing pipeline.
 *
 * Provider priority: Gemini (Google AI Studio) → OpenAI → Mock fallback
 *
 * Exports:
 *   getMetricsDiagnosis({ serverName, cpu, memory, logs })
 *     → Used by the metrics-ingest pipeline when a real server breaches thresholds.
 *
 *   getAIReasoning(nodeName, failureType)
 *     → Legacy: used by the incident route for historical incident records.
 *
 *   hasLlmProvider() → boolean
 *   CPU_CRITICAL      → number (re-exported from constants)
 */

const config       = require('../config/env');
const { CPU_CRITICAL, MEMORY_CRITICAL } = require('../config/constants');
const FAILURE_TYPES = require('../config/failureTypes');

// ── OpenAI lazy init ─────────────────────────────────────────────────────────
let _openai = null;
function getOpenAI() {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY not set');
  if (!_openai) {
    const { OpenAI } = require('openai');
    _openai = new OpenAI({ apiKey: config.openaiKey });
  }
  return _openai;
}

// ── Provider detection ───────────────────────────────────────────────────────
function hasLlmProvider() {
  return !!(config.geminiKey || config.openaiKey);
}

function pickLlmCaller() {
  if (config.geminiKey)  return { id: 'gemini', call: callGeminiJson };
  if (config.openaiKey)  return { id: 'openai', call: callOpenAiJson };
  return null;
}

// ── Model label helpers ──────────────────────────────────────────────────────
function sourceLabel(id) { return id === 'gemini' ? 'Google Gemini' : 'OpenAI'; }
function modelLabel(id)  { return id === 'gemini' ? config.geminiModel : config.openaiModel; }

// ── JSON extraction ──────────────────────────────────────────────────────────
function parseJsonFromLlmText(text) {
  const t     = String(text || '').trim();
  const start = t.indexOf('{');
  const end   = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM returned no JSON object');
  return JSON.parse(t.slice(start, end + 1));
}

// ── LLM callers ─────────────────────────────────────────────────────────────
async function callOpenAiJson(prompt) {
  const res = await getOpenAI().chat.completions.create({
    model:       config.openaiModel,
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.35,
    max_tokens:  512,
  });
  return parseJsonFromLlmText(res.choices[0]?.message?.content || '');
}

async function callGeminiJson(prompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(config.geminiKey);
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: {
      temperature:      0.35,
      maxOutputTokens:  1024,
      responseMimeType: 'application/json',
    },
  });
  const result = await model.generateContent(prompt);
  const raw    = result.response.text();
  try { return JSON.parse(raw); } catch { return parseJsonFromLlmText(raw); }
}

// ── Mock fallbacks ───────────────────────────────────────────────────────────
const MOCK_FALLBACKS = {
  HIGH_CPU: {
    root_cause: n => `Runaway cron job on ${n} consumed all CPU cycles, starving application threads.`,
    action:     'Identified and killed PID via process manager. Auto-scaled +2 replicas to absorb load.',
    confidence: 91,
  },
  HIGH_ERROR_RATE: {
    root_cause: n => `Upstream dependency timeout cascade on ${n} caused error rate to spike to 34%.`,
    action:     'Opened circuit breaker, retried with exponential backoff, rerouted traffic to healthy replicas.',
    confidence: 88,
  },
  MEMORY_LEAK: {
    root_cause: n => `Unbounded cache growth in ${n} exhausted heap, triggering OOM kill loop.`,
    action:     'Force-evicted pod, cleared in-memory cache, redeployed with memory limits & liveness probe.',
    confidence: 94,
  },
};

const METRICS_MOCK_FALLBACKS = {
  high_cpu: {
    root_cause:    s => `CPU saturation on ${s} — runaway worker thread causing scheduler starvation.`,
    action:        'kill_process',
    action_detail: 'Identified and terminated the offending PID. Verified thread pool health.',
    confidence:    89,
    explanation:   s => `Sustained CPU above ${CPU_CRITICAL}% on ${s} indicates a tight loop or unthrottled batch job.`,
  },
  high_memory: {
    root_cause:    s => `Memory leak in ${s} exhausted available heap — OOM kill loop triggered.`,
    action:        'restart_service',
    action_detail: 'Gracefully restarted service to flush heap. Applied memory limit enforcement.',
    confidence:    93,
    explanation:   s => `Memory pressure on ${s} crossed safe bounds. Controlled restart restores steady-state.`,
  },
  error_logs: {
    root_cause:    s => `Cascading error storm on ${s} — upstream dependency failure triggering 5xx responses.`,
    action:        'scale_up',
    action_detail: 'Provisioned +2 replicas and rerouted ingress via load balancer.',
    confidence:    86,
    explanation:   s => `Log evidence on ${s} shows fatal/error lines typical of dependency timeouts.`,
  },
  generic: {
    root_cause:    s => `Critical threshold breach on ${s} — automated diagnostic triggered.`,
    action:        'restart_service',
    action_detail: 'Executed graceful service restart and confirmed health probe recovery.',
    confidence:    75,
    explanation:   s => `Triage on ${s} could not isolate a single subsystem; conservative restart applied.`,
  },
};

const ALLOWED_ACTIONS = ['restart_service', 'scale_up', 'kill_process'];

// ── Prompt builders ──────────────────────────────────────────────────────────
function metricsPrompt(serverName, cpu, memory, logs) {
  const triggers = [
    cpu    > CPU_CRITICAL    ? `CPU at ${cpu}%`    : null,
    memory > MEMORY_CRITICAL ? `Memory at ${memory}%` : null,
    logs   ? `Log excerpt: "${String(logs).slice(0, 200)}"` : null,
  ].filter(Boolean).join('; ');

  return (
    `You are an expert SRE AI. Production server "${serverName}" crossed critical thresholds: ${triggers}. ` +
    `Diagnose and respond with a JSON object with EXACTLY these 5 keys:\n` +
    `- "root_cause": string (1-2 sentence technical explanation)\n` +
    `- "action": one of EXACTLY: "restart_service", "scale_up", or "kill_process"\n` +
    `- "action_detail": string (what was done to heal)\n` +
    `- "confidence": integer 0-100\n` +
    `- "explanation": string (2-4 sentences, plain English for an on-call engineer)\n` +
    `Respond ONLY with raw JSON. No markdown, no code blocks.`
  );
}

function mockMetricsKey(cpu, memory, logs) {
  const l = (logs || '').toLowerCase();
  const hasErr = /\b(error|critical|crit|fatal|exception|panic|oom|killed)\b/.test(l);
  if (cpu > CPU_CRITICAL)       return 'high_cpu';
  if (memory > MEMORY_CRITICAL) return 'high_memory';
  if (hasErr)                   return 'error_logs';
  return 'generic';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * AI diagnosis for real metric-triggered alerts.
 * @returns {{ source, model, latency_ms, root_cause, action, action_detail, confidence, explanation }}
 */
async function getMetricsDiagnosis({ serverName, cpu, memory, logs }) {
  const t0      = Date.now();
  const mockKey = mockMetricsKey(cpu, memory, logs);

  if (!hasLlmProvider()) {
    if (!config.allowAiMock) {
      const err = Object.assign(new Error('No LLM API key configured'), { code: 'NO_LLM_KEY', status: 503 });
      throw err;
    }
    const fb = METRICS_MOCK_FALLBACKS[mockKey];
    return {
      source:       'Mock Fallback',
      model:        'none',
      latency_ms:   Date.now() - t0,
      root_cause:   fb.root_cause(serverName),
      action:       fb.action,
      action_detail:fb.action_detail,
      confidence:   fb.confidence,
      explanation:  typeof fb.explanation === 'function' ? fb.explanation(serverName) : fb.explanation,
    };
  }

  const picked = pickLlmCaller();
  try {
    const parsed = await picked.call(metricsPrompt(serverName, cpu, memory, logs));
    if (!ALLOWED_ACTIONS.includes(parsed.action)) parsed.action = 'restart_service';
    return {
      source:       sourceLabel(picked.id),
      model:        modelLabel(picked.id),
      latency_ms:   Date.now() - t0,
      root_cause:   parsed.root_cause,
      action:       parsed.action,
      action_detail:parsed.action_detail,
      confidence:   Number(parsed.confidence) || 0,
      explanation:  parsed.explanation || 'No explanation returned.',
    };
  } catch (err) {
    console.warn('[AI] LLM call failed:', err.message, config.allowAiMock ? '→ mock' : '→ rethrow');
    if (!config.allowAiMock) throw err;
    const fb = METRICS_MOCK_FALLBACKS[mockKey];
    return {
      source:       'Mock Fallback',
      model:        'none',
      latency_ms:   Date.now() - t0,
      root_cause:   fb.root_cause(serverName),
      action:       fb.action,
      action_detail:fb.action_detail,
      confidence:   fb.confidence,
      explanation:  typeof fb.explanation === 'function' ? fb.explanation(serverName) : String(fb.explanation),
    };
  }
}

/**
 * AI reasoning for historical/incident route context.
 * @returns {{ source, root_cause, action, confidence }}
 */
async function getAIReasoning(nodeName, failureType) {
  const typeLabel = FAILURE_TYPES[failureType]?.label || 'Unknown failure';
  const prompt =
    `A cloud node "${nodeName}" experienced a "${typeLabel}" failure. ` +
    `Respond with raw JSON with exactly 3 keys: "root_cause" (1-2 sentences), ` +
    `"action" (remediation taken), "confidence" (integer 0-100). No markdown.`;

  const picked = pickLlmCaller();
  try {
    if (!picked) throw new Error('No LLM configured');
    const parsed = await picked.call(prompt);
    return { source: sourceLabel(picked.id), ...parsed };
  } catch (err) {
    console.warn('[AI] getAIReasoning failed:', err.message, config.allowAiMock ? '→ mock' : '→ rethrow');
    if (!config.allowAiMock) throw err;
    const fb = MOCK_FALLBACKS[failureType];
    return {
      source:     'Mock Fallback',
      root_cause: fb ? fb.root_cause(nodeName) : 'Unknown failure pattern.',
      action:     fb ? fb.action : 'Running standard restart protocol.',
      confidence: fb ? fb.confidence : 70,
    };
  }
}

module.exports = {
  getMetricsDiagnosis,
  getAIReasoning,
  hasLlmProvider,
  ALLOWED_ACTIONS,
  CPU_CRITICAL,
};
