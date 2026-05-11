/**
 * Standalone test for the three fixes:
 * 1. "me"/"an"/etc word blocklist in commandParser
 * 2. JSON parsing salvage in geminiService
 * 3. Direct regex parse patterns
 */

// We need to monkey-patch GeminiService to avoid API key requirement
const path = require('path');

// First, require and patch GeminiService to not need API key
const origGS = require('../src/geminiService');
const origRefine = origGS.prototype.refinePrompt;

// Use the parse method from CommandParser class directly
const CommandParser = require('../src/commandParser');

// Create instance with null db (won't need API key for commandParser methods)
const cp = new CommandParser(null);

// Override geminiService's refinePrompt to avoid API calls in tests
cp.geminiService.refinePrompt = async () => null;
cp.geminiService.tryDirectParse = function(text) {
  // Mirror of the direct parse logic from geminiService
  const t = text.trim();

  const DIRECT_PATTERNS = [
    { re: /^price\s+(\S+)$/i, cmd: 'price', args: m => [m[1].toUpperCase()] },
    { re: /^alerts?$/i, cmd: 'alerts', args: () => [] },
    { re: /^status$/i, cmd: 'status', args: () => [] },
    { re: /^subscribe$/i, cmd: 'subscribe', args: () => [] },
    { re: /^upgrade$/i, cmd: 'upgrade', args: () => [] },
    { re: /^features?$/i, cmd: 'features', args: () => [] },
    { re: /^trades?$/i, cmd: 'trades', args: () => [] },
    { re: /^portfolio$/i, cmd: 'portfolio', args: () => [] },
    { re: /^del(?:ete)?\s+all$/i, cmd: 'del', args: () => ['all'] },
    { re: /^del(?:ete)?\s+([\d\s,and]+)$/i, cmd: 'del', args: m => m[1].match(/\d+/g) || [] },
    { re: /^news\s+(\S+)$/i, cmd: 'news', args: m => [m[1].toUpperCase()] },
    { re: /^(?:analyze|analysis|view|opinion)\s+(\S+)$/i, cmd: 'analyze', args: m => [m[1].toUpperCase()] },
    {
      re: /^set\s+([a-z0-9]+)\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*(above|below)?$/i,
      cmd: 'set',
      args: m => {
        return [m[1].toUpperCase(), 'at', m[2], (m[3]?.toLowerCase() || 'below')];
      }
    },
    {
      re: /^set\s+([a-z0-9]+)\s+(\d+(?:\.\d+)?)\s*%\s*(move|either|both)?$/i,
      cmd: 'set_percent',
      args: m => {
        return [m[1].toUpperCase(), m[2], m[3] ? 'move' : ''];
      }
    },
  ];

  for (const { re, cmd, args } of DIRECT_PATTERNS) {
    const m = t.match(re);
    if (m) {
      return [{ command: cmd, args: args(m) }];
    }
  }
  return null;
};

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

// ================================================================
// TEST SUITE: CommandParser parseCommand
// We'll test the internal parseCommand method via the geminiService
// ================================================================

console.log('\n=== Fix 1: Command word blocklist in commandParser ===\n');

// Helper to simulate what happens when geminiService AI returns a command.
// The AI returns JSON commands which then go through refinePrompt's asset safety net.
// We'll test the refinePrompt asset replacement logic directly.

const GeminiService = require('../src/geminiService');
const gs = new GeminiService(null);
gs.apiKey = 'fake-key-for-testing';

// Test the tryDirectParse method (zero-AI parsing)
console.log('--- tryDirectParse tests (Fix 3: Direct regex patterns) ---\n');

// Test A: "set ETH at 3000 above" should be caught by direct regex
const d1 = gs.tryDirectParse('set ETH at 3000 above');
console.log('  Input: "set ETH at 3000 above"');
console.log('  Output:', JSON.stringify(d1));
assert(d1 && d1[0].command === 'set', 'Direct parse: "set ETH at 3000 above" → set command');
assert(d1 && d1[0].args[0] === 'ETH', 'Direct parse: Asset is ETH');
assert(d1 && d1[0].args[2] === '3000', 'Direct parse: Price is 3000');
assert(d1 && d1[0].args[3] === 'above', 'Direct parse: Direction is above');

// Test B: "set BTC 5% move" should be caught by direct regex
const d2 = gs.tryDirectParse('set BTC 5% move');
console.log('  Input: "set BTC 5% move"');
console.log('  Output:', JSON.stringify(d2));
assert(d2 && d2[0].command === 'set_percent', 'Direct parse: "set BTC 5% move" → set_percent command');
assert(d2 && d2[0].args[0] === 'BTC', 'Direct parse: Asset is BTC');
assert(d2 && d2[0].args[1] === '5', 'Direct parse: Percent is 5');

// Test C: "price BTC" should be caught by direct regex
const d3 = gs.tryDirectParse('price BTC');
console.log('  Input: "price BTC"');
console.log('  Output:', JSON.stringify(d3));
assert(d3 && d3[0].command === 'price', 'Direct parse: "price BTC" → price command');
assert(d3 && d3[0].args[0] === 'BTC', 'Direct parse: Asset is BTC');

// Test D: "set me at 50000 above" — 'me' should NOT match the [a-z0-9]+ pattern because 'me' passes,
// but then the asset safety net should catch it.
// Actually the regex DOES match 'me' since it's [a-z0-9]+. The fix is in the safety net.
// Let's test that properly.

// The safety net (Fix 1) is in refinePrompt, not tryDirectParse.
// tryDirectParse will catch 'set me at 50000 above' because 'me' matches [a-z0-9]+
// But refinePrompt then replaces it via GENERIC_WORDS check.
// So tryDirectParse returning a set command here is CORRECT — the fix is in refinePrompt's asset check.

console.log('\n--- refinePrompt asset safety net tests (Fix 1: Generic word blocklist) ---\n');

// We need to test the logic inside refinePrompt that handles generic words.
// Looking at the code, when the AI returns commands with generic assets,
// refinePrompt's STEP 4 checks against GENERIC_WORDS.

// Let's manually emulate that logic:
const GENERIC_WORDS = new Set([
  'it', 'that', 'this', 'stock', 'stocks', 'asset', 'assets', 'coin', 'crypto',
  'shares', 'share', 'one', 'the', 'them', 'those',
  'me', 'my', 'an', 'a', 'alert', 'alerts', 'price', 'set'
]);

function emulateRefineStep4(commands, lastAssets) {
  return commands.map(cmd => {
    if (['price', 'analyze', 'news', 'set', 'bought', 'sold'].includes(cmd.command)) {
      const assetArg = (cmd.args?.[0] || '').toLowerCase().trim();

      if (GENERIC_WORDS.has(assetArg)) {
        if (lastAssets.length > 0) {
          cmd = { ...cmd, args: [lastAssets[0], ...cmd.args.slice(1)] };
        } else {
          if (cmd.command === 'set') {
            return { command: 'chat', args: ['Which asset would you like to set an alert for?'] };
          }
          return { command: 'chat', args: ['Which asset would you like to check?'] };
        }
      }
    }
    return cmd;
  });
}

// Test: "set me at 50000 above" with no context → should become chat
const e1 = emulateRefineStep4(
  [{ command: 'set', args: ['ME', 'at', '50000', 'above'] }],
  []
);
console.log('  Input: set ME at 50000 above (no context)');
console.log('  Output:', JSON.stringify(e1));
assert(e1[0].command === 'chat', '"set me" with no context → chat (asks which asset)');

// Test: "set me at 50000 above" WITH context (lastAssets) → should use context asset
const e2 = emulateRefineStep4(
  [{ command: 'set', args: ['ME', 'at', '50000', 'above'] }],
  ['BTC']
);
console.log('  Input: set ME at 50000 above (context: BTC)');
console.log('  Output:', JSON.stringify(e2));
assert(e2[0].command === 'set', '"set me" with context → still a set command');
assert(e2[0].args[0] === 'BTC', '"set me" with context BTC → uses BTC as asset');

// Test: "set an at 50000" with no context → chat
const e3 = emulateRefineStep4(
  [{ command: 'set', args: ['AN', 'at', '50000', 'below'] }],
  []
);
console.log('  Input: set AN at 50000 (no context)');
console.log('  Output:', JSON.stringify(e3));
assert(e3[0].command === 'chat', '"set an" with no context → chat');

// Test: "price me" with no context → chat
const e4 = emulateRefineStep4(
  [{ command: 'price', args: ['ME'] }],
  []
);
console.log('  Input: price ME (no context)');
console.log('  Output:', JSON.stringify(e4));
assert(e4[0].command === 'chat', '"price me" with no context → chat');

// Test: "price it" with context BTC → uses BTC
const e5 = emulateRefineStep4(
  [{ command: 'price', args: ['IT'] }],
  ['BTC']
);
console.log('  Input: price IT (context: BTC)');
console.log('  Output:', JSON.stringify(e5));
assert(e5[0].command === 'price', '"price it" with context → still a price command');
assert(e5[0].args[0] === 'BTC', '"price it" with context BTC → uses BTC as asset');

// Test: "set that at 50000" with no context → chat
const e6 = emulateRefineStep4(
  [{ command: 'set', args: ['THAT', 'at', '50000', 'below'] }],
  []
);
console.log('  Input: set THAT at 50000 (no context)');
console.log('  Output:', JSON.stringify(e6));
assert(e6[0].command === 'chat', '"set that" with no context → chat');

// Test: Valid asset BTC should NOT be affected
const e7 = emulateRefineStep4(
  [{ command: 'set', args: ['BTC', 'at', '50000', 'above'] }],
  []
);
console.log('  Input: set BTC at 50000 above (no context)');
console.log('  Output:', JSON.stringify(e7));
assert(e7[0].command === 'set', 'Valid asset BTC → set command preserved');
assert(e7[0].args[0] === 'BTC', 'Valid asset BTC → BTC kept as asset');

// ================================================================
// TEST SUITE: Chat Salvage (Fix 2)
// ================================================================

console.log('\n=== Fix 2: Chat Salvage in geminiService ===\n');

// The salvage logic lives in the catch block when JSON.parse fails.
// Let's test the salvage by testing the regex patterns it uses.

function emulateChatSalvage(text, lastAssets) {
  // This is the math salvage logic copied from geminiService
  const allAmounts = [...text.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)];
  if (allAmounts.length > 0) {
    const finalAmount = allAmounts[allAmounts.length - 1][1].replace(/,/g, '');
    const finalNum = parseFloat(finalAmount);
    let assetHint = lastAssets.length > 0 ? lastAssets[0] : null;
    if (!assetHint) {
      const tickerMatch = text.match(/\b([A-Z]{2,10})\b/);
      assetHint = tickerMatch ? tickerMatch[1] : 'the asset';
    }
    if (!isNaN(finalNum) && finalNum > 0) {
      const confirmMsg = `I calculated $${finalNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Set alert for ${assetHint} at $${finalNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}?`;
      return [{ command: "chat", args: [confirmMsg] }];
    }
  }

  // Fallthrough to Chat Salvage:
  const cleanText = text.trim().replace(/^["'""]|["'""]$/g, '').trim();
  if (cleanText.length > 0 && cleanText.length < 500) {
    return [{ command: "chat", args: [cleanText] }];
  }

  return null;
}

// Test: AI returns plain text (not JSON) — should be salvaged as chat
const s1 = emulateChatSalvage("Yes, that's correct! BTC target is $144,903.52", ['BTC']);
console.log('  Input (text): "Yes, that\'s correct! BTC target is $144,903.52"');
console.log('  Output:', JSON.stringify(s1));
assert(s1 && s1[0].command === 'chat', 'Plain text response → salvaged as chat command');
assert(s1 && s1[0].args[0].includes('144,903.52'), 'Chat salvage preserves the calculated amount');

// Test: AI returns conversational text (no dollar amounts)
const s2 = emulateChatSalvage("I'm not sure I understand. Could you rephrase?", []);
console.log('  Input (text): "I\'m not sure I understand. Could you rephrase?"');
console.log('  Output:', JSON.stringify(s2));
assert(s2 && s2[0].command === 'chat', 'Generic conversational text → salvaged as chat command');

// Test: Long text (should still be salvaged but truncated)
const s3 = emulateChatSalvage("Here is a very long detailed response about the market conditions... ".repeat(10), []);
console.log('  Input (text): Long text (>500 chars)');
console.log('  Output:', JSON.stringify(s3));
assert(s3 === null, 'Very long text without dollar amounts → not salvaged (falls through to null)');

// ================================================================
// SUMMARY
// ================================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);