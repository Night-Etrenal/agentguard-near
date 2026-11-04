#!/usr/bin/env node
import { compilePolicy, patchToContractCalls } from '../src/policy_compiler.js';
const text = process.argv.slice(2).join(' ') ||
  'max 0.5 NEAR per tx, 2 NEAR per day, only pay allowlist, allow merchant.near, block scam.near';
const useLlm = process.env.AGENTGUARD_LLM === '1';
const patch = await compilePolicy(text, { useLlm });
console.log(JSON.stringify({ patch, calls: patchToContractCalls(patch) }, null, 2));
