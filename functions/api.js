const server = require('serverless-http');

import app from '../index.js'
// Define your Cloud Function
exports.handler = server(app);