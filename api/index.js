'use strict';
// Vercel serverless entrypoint. Exports the Express app so Vercel's modern
// Node runtime handles it as a function (this preserves Set-Cookie / headers,
// unlike the legacy builds+routes wrapper).
module.exports = require('../server.js');
