const express = require('express');

const CODEX_ROOT_POST_PATHS = Object.freeze([
  '/responses',
  '/images/generations',
  '/images/edits',
]);

function createCodexCompatibilityRouter({ proxyRouter }) {
  if (typeof proxyRouter !== 'function') throw new TypeError('proxyRouter is required');
  const router = express.Router();
  for (const path of CODEX_ROOT_POST_PATHS) router.post(path, proxyRouter);
  return router;
}

module.exports = { CODEX_ROOT_POST_PATHS, createCodexCompatibilityRouter };
