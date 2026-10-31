/**
 * Mailroom configuration.
 *
 * Planted bug: a live-looking API key is committed to the repository.
 */

const MOON_API_KEY = 'sk-live-moon-1234567890abcdef';

function getApiKey() {
  return MOON_API_KEY;
}

module.exports = { getApiKey };
