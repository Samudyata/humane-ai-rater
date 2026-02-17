/**
 * Chrome Storage Helpers
 * Manages ratings data, API key, and leaderboard stats.
 */

const STORAGE_KEYS = {
  API_KEY: 'gemini_api_key',
  RATINGS: 'ratings',
  LEADERBOARD: 'leaderboard'
};

/**
 * Save Gemini API key
 */
async function saveApiKey(key) {
  await chrome.storage.local.set({ [STORAGE_KEYS.API_KEY]: key });
}

/**
 * Get Gemini API key
 */
async function getApiKey() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.API_KEY);
  return result[STORAGE_KEYS.API_KEY] || '';
}

/**
 * Save a rating result
 */
async function saveRating(model, userPrompt, aiResponse, evaluation) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.RATINGS);
  const ratings = result[STORAGE_KEYS.RATINGS] || [];

  const rating = {
    id: Date.now().toString(),
    model,
    userPrompt: userPrompt.substring(0, 200),
    aiResponsePreview: aiResponse.substring(0, 200),
    overallScore: calculateOverallScore(evaluation.principles),
    principles: evaluation.principles,
    confidence: evaluation.confidence,
    globalViolations: evaluation.globalViolations || [],
    timestamp: new Date().toISOString()
  };

  ratings.unshift(rating);

  // Keep last 50 ratings
  if (ratings.length > 50) ratings.length = 50;

  await chrome.storage.local.set({ [STORAGE_KEYS.RATINGS]: ratings });

  // Update leaderboard
  await updateLeaderboard(model, rating.overallScore);

  return rating;
}

/**
 * Get all stored ratings
 */
async function getRatings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.RATINGS);
  return result[STORAGE_KEYS.RATINGS] || [];
}

/**
 * Update leaderboard stats for a model
 */
async function updateLeaderboard(model, score) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LEADERBOARD);
  const leaderboard = result[STORAGE_KEYS.LEADERBOARD] || {};

  if (!leaderboard[model]) {
    leaderboard[model] = { totalScore: 0, count: 0, avgScore: 0 };
  }

  leaderboard[model].totalScore += score;
  leaderboard[model].count += 1;
  leaderboard[model].avgScore = parseFloat(
    (leaderboard[model].totalScore / leaderboard[model].count).toFixed(2)
  );

  await chrome.storage.local.set({ [STORAGE_KEYS.LEADERBOARD]: leaderboard });
}

/**
 * Get leaderboard data
 */
async function getLeaderboard() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LEADERBOARD);
  return result[STORAGE_KEYS.LEADERBOARD] || {};
}

/**
 * Clear all stored data
 */
async function clearAllData() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.RATINGS,
    STORAGE_KEYS.LEADERBOARD
  ]);
}
