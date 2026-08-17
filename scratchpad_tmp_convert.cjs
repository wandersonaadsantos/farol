const fs = require('fs');
const f = 'lib/engine/decision.js';
let s = fs.readFileSync(f, 'utf8');
s = s.replace("'use strict';\n", '');
s = s.replace("const fs = require('fs');", "import fs from 'node:fs';");
s = s.replace("const path = require('path');", "import path from 'node:path';");
s = s.replace("const crypto = require('crypto');", "import crypto from 'node:crypto';");
s = s.replace("const { STATE_DIR } = require('../paths');", "import { STATE_DIR } from '../paths.js';");
s = s.replace("const { run, writeJsonAtomic } = require('../io');", "import io from '../io.js';\nimport { writeJsonAtomic } from '../io.js';");
s = s.replace("const {\n  publicReviewLanguageIssues, normalizeReviewPayload,\n  decisionForUi, reviewMarkdownForUi,\n} = require('./public-review');",
              "import {\n  publicReviewLanguageIssues, normalizeReviewPayload,\n  decisionForUi, reviewMarkdownForUi,\n} from './public-review.js';");
s = s.replace(/\bawait run\(/g, 'await io.run(');

const oldExport = `module.exports = {
  recordDecision, resolveIntoHistory, decisionByKey, reviewActions, saveDecisions,
  myReviewsWithTime, myReviewStates, reconcilePending,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap, checkpointGap,
  postReview, postReviewFromSession, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS,
};`;
const newExport = `const decisionMod = {
  recordDecision, resolveIntoHistory, decisionByKey, reviewActions, saveDecisions,
  myReviewsWithTime, myReviewStates, reconcilePending,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap, checkpointGap,
  postReview, postReviewFromSession, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS,
};
export default decisionMod;
export {
  recordDecision, resolveIntoHistory, decisionByKey, reviewActions, saveDecisions,
  myReviewsWithTime, myReviewStates, reconcilePending,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints, contestations, coverageGap, checkpointGap,
  postReview, postReviewFromSession, inlineFallbackPayload, decisionForUi,
  reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner,
  writeMemory, removeTeamMember, decide,
  TERMINAL_SESSION_MAX_MS,
};
`;
if (!s.includes(oldExport)) { console.error('EXPORT BLOCK NOT FOUND'); process.exit(1); }
s = s.replace(oldExport, newExport);
fs.writeFileSync(f, s);
console.log('done');
