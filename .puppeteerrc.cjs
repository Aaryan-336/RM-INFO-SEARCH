const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer to a path inside the project directory.
  // This ensures the browser binary is packaged and preserved during Render's build-to-runtime transition.
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
