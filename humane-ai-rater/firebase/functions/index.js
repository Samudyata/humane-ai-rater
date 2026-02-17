/**
 * Humane AI Rater - Cloud Functions
 *
 * Handles:
 * 1. Rating validation and anti-spoofing
 * 2. Rate limiting per device
 * 3. Aggregate score computation
 * 4. Anomaly detection and flagging
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

// Configuration
const CONFIG = {
  MAX_RATINGS_PER_DAY: 50,
  MIN_VIEWPORT_TIME_MS: 500,
  BURST_WINDOW_MS: 300000, // 5 minutes
  BURST_THRESHOLD: 10,
  UNIFORM_RATING_THRESHOLD: 0.95,
  MIN_RATINGS_FOR_UNIFORM_CHECK: 20,
};

/**
 * Validate and process incoming ratings
 * Triggered when a new rating document is created
 */
exports.validateRating = functions.firestore
  .document('ratings/{ratingId}')
  .onCreate(async (snap, context) => {
    const rating = snap.data();
    const ratingId = context.params.ratingId;

    try {
      // Check rate limiting
      const isLimited = await checkRateLimit(rating.deviceHash);
      if (isLimited) {
        await snap.ref.update({
          verified: false,
          flags: admin.firestore.FieldValue.arrayUnion('RATE_LIMITED'),
          trustScore: 0,
        });
        return;
      }

      // Collect flags
      const flags = [];
      let trustScore = 1.0;

      // Check viewport time (anti-bot)
      if (rating.viewportTime < CONFIG.MIN_VIEWPORT_TIME_MS) {
        flags.push('TOO_FAST');
        trustScore *= 0.3;
      }

      // Check behavioral signals
      const signals = rating.behaviorSignals || {};
      if (!signals.hasMouseMoved && !signals.hasTouched) {
        flags.push('NO_INTERACTION');
        trustScore *= 0.5;
      }

      if (!signals.documentVisible) {
        flags.push('BACKGROUND_TAB');
        trustScore *= 0.7;
      }

      // Check for burst activity
      const hasBurst = await checkBurstActivity(rating.deviceHash);
      if (hasBurst) {
        flags.push('BURST_ACTIVITY');
        trustScore *= 0.4;
      }

      // Check for uniform ratings pattern
      const isUniform = await checkUniformRatings(rating.deviceHash, rating.rating);
      if (isUniform) {
        flags.push('UNIFORM_RATINGS');
        trustScore *= 0.3;
      }

      // Update rating with verification results
      await snap.ref.update({
        verified: flags.length === 0,
        flags: flags.length > 0 ? flags : admin.firestore.FieldValue.delete(),
        trustScore: Math.max(0.1, trustScore),
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update rate limit counter
      await incrementRateLimit(rating.deviceHash);

      // Update aggregates if verified or has decent trust score
      if (trustScore >= 0.5) {
        await updateAggregates(rating.platform, rating.rating, trustScore);
      }

      // Flag for manual review if suspicious
      if (flags.length > 1 || trustScore < 0.3) {
        await flagForReview(ratingId, rating, flags, trustScore);
      }

    } catch (error) {
      console.error('Error validating rating:', error);
      await snap.ref.update({
        verified: false,
        flags: admin.firestore.FieldValue.arrayUnion('PROCESSING_ERROR'),
        error: error.message,
      });
    }
  });

/**
 * Check if device has exceeded daily rate limit
 */
async function checkRateLimit(deviceHash) {
  const today = Math.floor(Date.now() / 86400000).toString();
  const limitRef = db.collection('rateLimits').doc(deviceHash).collection('days').doc(today);

  const limitDoc = await limitRef.get();
  if (!limitDoc.exists) return false;

  return limitDoc.data().count >= CONFIG.MAX_RATINGS_PER_DAY;
}

/**
 * Increment rate limit counter for device
 */
async function incrementRateLimit(deviceHash) {
  const today = Math.floor(Date.now() / 86400000).toString();
  const limitRef = db.collection('rateLimits').doc(deviceHash).collection('days').doc(today);

  await limitRef.set({
    count: admin.firestore.FieldValue.increment(1),
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Check for burst activity (many ratings in short time)
 */
async function checkBurstActivity(deviceHash) {
  const fiveMinutesAgo = Date.now() - CONFIG.BURST_WINDOW_MS;

  const recentRatings = await db.collection('ratings')
    .where('deviceHash', '==', deviceHash)
    .where('timestamp', '>', fiveMinutesAgo)
    .limit(CONFIG.BURST_THRESHOLD + 1)
    .get();

  return recentRatings.size >= CONFIG.BURST_THRESHOLD;
}

/**
 * Check if user has uniform rating pattern (all positive or all negative)
 */
async function checkUniformRatings(deviceHash, currentRating) {
  const recentRatings = await db.collection('ratings')
    .where('deviceHash', '==', deviceHash)
    .orderBy('timestamp', 'desc')
    .limit(CONFIG.MIN_RATINGS_FOR_UNIFORM_CHECK)
    .get();

  if (recentRatings.size < CONFIG.MIN_RATINGS_FOR_UNIFORM_CHECK) {
    return false;
  }

  const ratings = recentRatings.docs.map(doc => doc.data().rating);
  const positiveRatio = ratings.filter(r => r === 'positive').length / ratings.length;

  return positiveRatio > CONFIG.UNIFORM_RATING_THRESHOLD ||
         positiveRatio < (1 - CONFIG.UNIFORM_RATING_THRESHOLD);
}

/**
 * Update aggregate scores for platform
 */
async function updateAggregates(platform, rating, trustScore) {
  const aggregateRef = db.collection('aggregates').doc(platform);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(aggregateRef);

    const currentData = doc.exists ? doc.data() : {
      totalRatings: 0,
      positiveCount: 0,
      negativeCount: 0,
      weightedPositive: 0,
      weightedTotal: 0,
      weeklyTrend: [],
    };

    // Update counts
    currentData.totalRatings += 1;
    currentData.weightedTotal += trustScore;

    if (rating === 'positive') {
      currentData.positiveCount += 1;
      currentData.weightedPositive += trustScore;
    } else {
      currentData.negativeCount += 1;
    }

    currentData.lastUpdated = admin.firestore.FieldValue.serverTimestamp();

    transaction.set(aggregateRef, currentData, { merge: true });
  });

  // Update global stats
  await db.collection('stats').doc('global').set({
    totalRatings: admin.firestore.FieldValue.increment(1),
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Flag suspicious rating for manual review
 */
async function flagForReview(ratingId, rating, flags, trustScore) {
  await db.collection('flagged').doc(ratingId).set({
    ...rating,
    flags,
    trustScore,
    flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewed: false,
  });
}

/**
 * Scheduled function to compute weekly trends
 * Runs daily at midnight UTC
 */
exports.computeWeeklyTrends = functions.pubsub
  .schedule('0 0 * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    const platforms = ['chatgpt', 'claude', 'gemini', 'grok'];
    const oneDayAgo = Date.now() - 86400000;
    const sevenDaysAgo = Date.now() - (7 * 86400000);

    for (const platform of platforms) {
      try {
        // Get verified ratings from last 24 hours
        const dailyRatings = await db.collection('ratings')
          .where('platform', '==', platform)
          .where('verified', '==', true)
          .where('timestamp', '>', oneDayAgo)
          .get();

        if (dailyRatings.empty) continue;

        const positive = dailyRatings.docs.filter(d => d.data().rating === 'positive').length;
        const total = dailyRatings.size;
        const dailyScore = Math.round((positive / total) * 100);

        // Update weekly trend
        const aggregateRef = db.collection('aggregates').doc(platform);
        const doc = await aggregateRef.get();

        if (doc.exists) {
          let weeklyTrend = doc.data().weeklyTrend || [];
          weeklyTrend.push(dailyScore);

          // Keep only last 7 days
          if (weeklyTrend.length > 7) {
            weeklyTrend = weeklyTrend.slice(-7);
          }

          await aggregateRef.update({ weeklyTrend });
        }
      } catch (error) {
        console.error(`Error computing trends for ${platform}:`, error);
      }
    }
  });

/**
 * Cleanup old rate limit documents (older than 7 days)
 * Runs weekly
 */
exports.cleanupRateLimits = functions.pubsub
  .schedule('0 0 * * 0')
  .timeZone('UTC')
  .onRun(async (context) => {
    const sevenDaysAgo = Math.floor((Date.now() - (7 * 86400000)) / 86400000).toString();

    // This is a simplified cleanup - in production you'd want batch deletes
    const oldLimits = await db.collectionGroup('days')
      .where(admin.firestore.FieldPath.documentId(), '<', sevenDaysAgo)
      .limit(500)
      .get();

    const batch = db.batch();
    oldLimits.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    console.log(`Cleaned up ${oldLimits.size} old rate limit documents`);
  });

/**
 * HTTP function to get public aggregates (for extension popup)
 */
exports.getAggregates = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const aggregates = await db.collection('aggregates').get();

    const result = {};
    aggregates.docs.forEach(doc => {
      const data = doc.data();
      result[doc.id] = {
        totalRatings: data.totalRatings || 0,
        positiveCount: data.positiveCount || 0,
        negativeCount: data.negativeCount || 0,
        weeklyTrend: data.weeklyTrend || [],
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching aggregates:', error);
    res.status(500).json({ error: 'Failed to fetch aggregates' });
  }
});

/**
 * HTTP function to submit anonymous ratings (for extension)
 * This writes to the ratings collection which triggers validateRating
 */
exports.submitAnonymousRating = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const {
      deviceHash,
      platform,
      rating,
      overallScore,
      principles,
      userPromptPreview,
      viewportTime,
      behaviorSignals,
      timestamp,
      userRatings
    } = req.body;

    // Basic validation
    if (!deviceHash || !platform || !rating) {
      res.status(400).json({ error: 'Missing required fields: deviceHash, platform, rating' });
      return;
    }

    // Create the rating document (this triggers validateRating)
    const ratingDoc = {
      deviceHash,
      platform,
      rating,
      overallScore: overallScore || 0,
      principles: principles || [],
      userPromptPreview: userPromptPreview || '',
      viewportTime: viewportTime || 0,
      behaviorSignals: behaviorSignals || {},
      timestamp: timestamp || new Date().toISOString(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'extension',
      userRatings: userRatings || null
    };

    const docRef = await db.collection('ratings').add(ratingDoc);

    res.json({
      success: true,
      ratingId: docRef.id,
      message: 'Rating submitted for validation'
    });
  } catch (error) {
    console.error('Error submitting rating:', error);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// ─── Helpers for authenticated endpoints ────────────────────────────────────

const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');

const HUMANENESS_DIMENSIONS = [
  'respectUserAttention',
  'enableMeaningfulChoices',
  'enhanceHumanCapabilities',
  'protectDignitySafety',
  'fosterHealthyRelationships',
  'prioritizeLongTermWellbeing',
  'beTransparentHonest',
  'designForEquityInclusion',
];

/**
 * Verify Firebase Auth ID token from Authorization header.
 * Returns decoded token on success, or throws with status/message.
 */
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Missing or malformed Authorization header');
    err.status = 401;
    throw err;
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    const err = new Error('Invalid or expired ID token');
    err.status = 401;
    throw err;
  }
}

/**
 * Set CORS headers and handle OPTIONS preflight.
 * Returns true if this was an OPTIONS request (already handled).
 */
function handleCors(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

/**
 * Generate mock humaneness ratings from markdown content.
 * Scores are deterministic per markdown hash so repeated calls return the same result.
 */
function generateMockRatings(markdown, platform) {
  const hash = crypto.createHash('sha256').update(markdown).digest('hex');

  // Platform bias: slight adjustments to make results feel platform-specific
  const platformBias = { chatgpt: 0.05, claude: 0.08, gemini: 0.02, grok: -0.02 };
  const bias = platformBias[platform] || 0;

  const dimensions = {};
  HUMANENESS_DIMENSIONS.forEach((dim, i) => {
    // Derive a score from the hash, dimension index, and platform bias
    const dimSeed = parseInt(hash.substring(i * 2, i * 2 + 4), 16);
    const rawScore = ((dimSeed % 500) / 500) * 0.6 + 0.3; // 0.3–0.9 range
    const score = Math.min(1, Math.max(0, parseFloat((rawScore + bias).toFixed(2))));
    dimensions[dim] = {
      score,
      reasoning: `Analysis of ${dim}: The conversation ${score >= 0.6 ? 'demonstrates' : 'could improve on'} this dimension based on content patterns.`,
    };
  });

  const scores = Object.values(dimensions).map(d => d.score);
  const overallScore = parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2));

  return {
    overallScore,
    dimensions,
    summary: `Humaneness analysis for ${platform} conversation (${markdown.length} chars). Overall score: ${overallScore}.`,
  };
}

// ─── Authenticated Cloud Functions ──────────────────────────────────────────

/**
 * POST /createUserProfile
 * Creates or updates a user profile after client-side Firebase Auth signup.
 * Body: { displayName?, preferredPlatforms? }
 */
exports.createUserProfile = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const decoded = await verifyAuth(req);
    const uid = decoded.uid;
    const { displayName, preferredPlatforms } = req.body || {};

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      await userRef.update({
        lastLoginAt: FieldValue.serverTimestamp(),
      });
      res.status(200).json({ uid, message: 'User profile updated' });
    } else {
      // Initialize per-dimension score accumulators
      const dimensionScores = {};
      HUMANENESS_DIMENSIONS.forEach(dim => {
        dimensionScores[dim] = { apiTotal: 0, apiCount: 0, userTotal: 0, userCount: 0 };
      });

      await userRef.set({
        uid,
        email: decoded.email || null,
        displayName: displayName || decoded.name || null,
        createdAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
        totalRatings: 0,
        totalReviews: 0,
        preferredPlatforms: preferredPlatforms || [],
        dimensionScores,
      });
      res.status(201).json({ uid, message: 'User profile created' });
    }
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});

/**
 * POST /rate
 * Accepts conversation markdown, generates mock humaneness ratings, stores them.
 * Optionally accepts userRatings at submission time.
 * Body: { markdown, platform, userRatings? }
 */
exports.rate = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const decoded = await verifyAuth(req);
    const uid = decoded.uid;
    const { markdown, platform, userRatings } = req.body || {};

    if (!markdown || typeof markdown !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "markdown" field' });
      return;
    }
    if (!platform || !['chatgpt', 'claude', 'gemini', 'grok'].includes(platform)) {
      res.status(400).json({ error: 'Missing or invalid "platform" field. Must be one of: chatgpt, claude, gemini, grok' });
      return;
    }

    // Validate optional userRatings if provided
    if (userRatings) {
      if (typeof userRatings !== 'object') {
        res.status(400).json({ error: '"userRatings" must be an object' });
        return;
      }
      if (typeof userRatings.overallScore !== 'number' ||
          userRatings.overallScore < 0 || userRatings.overallScore > 1) {
        res.status(400).json({ error: 'userRatings.overallScore must be a number between 0 and 1' });
        return;
      }
    }

    const markdownHash = crypto.createHash('sha256').update(markdown).digest('hex');
    const apiRatings = generateMockRatings(markdown, platform);

    const hasReview = !!userRatings;
    const status = hasReview ? 'reviewed' : 'pending_review';

    const ratingRef = db.collection('user_ratings').doc();
    const ratingId = ratingRef.id;

    await ratingRef.set({
      userId: uid,
      ratingId,
      platform,
      conversationMarkdown: markdown,
      markdownHash,
      createdAt: FieldValue.serverTimestamp(),
      reviewedAt: hasReview ? FieldValue.serverTimestamp() : null,
      status,
      apiRatings,
      userRatings: userRatings || null,
    });

    // Update user profile: increment counters + accumulate dimension scores
    const userUpdate = {
      totalRatings: FieldValue.increment(1),
    };
    if (hasReview) {
      userUpdate.totalReviews = FieldValue.increment(1);
    }

    // Accumulate per-dimension API scores (always)
    HUMANENESS_DIMENSIONS.forEach(dim => {
      if (apiRatings.dimensions[dim]) {
        userUpdate[`dimensionScores.${dim}.apiTotal`] = FieldValue.increment(apiRatings.dimensions[dim].score);
        userUpdate[`dimensionScores.${dim}.apiCount`] = FieldValue.increment(1);
      }
    });

    // Accumulate per-dimension user scores (if provided)
    if (hasReview && userRatings.dimensions) {
      HUMANENESS_DIMENSIONS.forEach(dim => {
        if (userRatings.dimensions[dim] && typeof userRatings.dimensions[dim].score === 'number') {
          userUpdate[`dimensionScores.${dim}.userTotal`] = FieldValue.increment(userRatings.dimensions[dim].score);
          userUpdate[`dimensionScores.${dim}.userCount`] = FieldValue.increment(1);
        }
      });
    }

    await db.collection('users').doc(uid).update(userUpdate);

    res.status(201).json({ ratingId, apiRatings, userRatings: userRatings || null, status });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});

/**
 * POST /submitReview
 * Accepts user's finalized review of API-generated ratings.
 * Body: { ratingId, userRatings: { overallScore, dimensions: { ... }, overallComment } }
 */
exports.submitReview = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const decoded = await verifyAuth(req);
    const uid = decoded.uid;
    const { ratingId, userRatings } = req.body || {};

    if (!ratingId || typeof ratingId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "ratingId" field' });
      return;
    }
    if (!userRatings || typeof userRatings !== 'object') {
      res.status(400).json({ error: 'Missing or invalid "userRatings" field' });
      return;
    }
    if (typeof userRatings.overallScore !== 'number' ||
        userRatings.overallScore < 0 || userRatings.overallScore > 1) {
      res.status(400).json({ error: 'userRatings.overallScore must be a number between 0 and 1' });
      return;
    }

    const ratingRef = db.collection('user_ratings').doc(ratingId);
    const ratingDoc = await ratingRef.get();

    if (!ratingDoc.exists) {
      res.status(404).json({ error: 'Rating not found' });
      return;
    }

    const ratingData = ratingDoc.data();

    if (ratingData.userId !== uid) {
      res.status(403).json({ error: 'You do not own this rating' });
      return;
    }

    if (ratingData.status === 'reviewed') {
      res.status(409).json({ error: 'This rating has already been reviewed' });
      return;
    }

    await ratingRef.update({
      userRatings,
      status: 'reviewed',
      reviewedAt: FieldValue.serverTimestamp(),
    });

    // Update user profile: increment totalReviews + accumulate user dimension scores
    const userUpdate = {
      totalReviews: FieldValue.increment(1),
    };
    if (userRatings.dimensions) {
      HUMANENESS_DIMENSIONS.forEach(dim => {
        if (userRatings.dimensions[dim] && typeof userRatings.dimensions[dim].score === 'number') {
          userUpdate[`dimensionScores.${dim}.userTotal`] = FieldValue.increment(userRatings.dimensions[dim].score);
          userUpdate[`dimensionScores.${dim}.userCount`] = FieldValue.increment(1);
        }
      });
    }
    await db.collection('users').doc(uid).update(userUpdate);

    res.status(200).json({ ratingId, status: 'reviewed', message: 'Review submitted' });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});

/**
 * GET /user
 * Returns the authenticated user's profile for the extension UI.
 */
exports.user = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const decoded = await verifyAuth(req);
    const uid = decoded.uid;

    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: 'User profile not found. Call createUserProfile first.' });
      return;
    }

    const data = userDoc.data();

    // Compute per-dimension averages from accumulated scores
    const dimensionAverages = {};
    const rawScores = data.dimensionScores || {};
    HUMANENESS_DIMENSIONS.forEach(dim => {
      const d = rawScores[dim] || {};
      dimensionAverages[dim] = {
        apiAverage: d.apiCount > 0 ? parseFloat((d.apiTotal / d.apiCount).toFixed(2)) : null,
        userAverage: d.userCount > 0 ? parseFloat((d.userTotal / d.userCount).toFixed(2)) : null,
        apiCount: d.apiCount || 0,
        userCount: d.userCount || 0,
      };
    });

    res.status(200).json({
      uid: data.uid,
      email: data.email,
      displayName: data.displayName,
      createdAt: data.createdAt,
      lastLoginAt: data.lastLoginAt,
      totalRatings: data.totalRatings,
      totalReviews: data.totalReviews,
      preferredPlatforms: data.preferredPlatforms,
      dimensionAverages,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});

/**
 * GET /getUserRatings
 * Returns the user's most recent rating and a summary of all their ratings.
 */
exports.getUserRatings = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const decoded = await verifyAuth(req);
    const uid = decoded.uid;

    // Get user profile for counts
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    const userData = userDoc.data();

    // Get most recent rating
    const recentSnap = await db.collection('user_ratings')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    let lastRating = null;
    if (!recentSnap.empty) {
      const doc = recentSnap.docs[0];
      const data = doc.data();
      lastRating = {
        ratingId: data.ratingId,
        platform: data.platform,
        status: data.status,
        createdAt: data.createdAt,
        apiRatings: data.apiRatings,
        userRatings: data.userRatings,
      };
    }

    // Build summary from all user ratings
    const allRatingsSnap = await db.collection('user_ratings')
      .where('userId', '==', uid)
      .get();

    let totalApiScore = 0;
    let totalUserScore = 0;
    let reviewedCount = 0;
    let pendingReviewCount = 0;
    const platformBreakdown = {};

    allRatingsSnap.docs.forEach(doc => {
      const data = doc.data();
      totalApiScore += data.apiRatings ? data.apiRatings.overallScore : 0;

      if (data.status === 'reviewed' && data.userRatings) {
        totalUserScore += data.userRatings.overallScore;
        reviewedCount++;
      }
      if (data.status === 'pending_review') {
        pendingReviewCount++;
      }

      const p = data.platform;
      if (!platformBreakdown[p]) {
        platformBreakdown[p] = { total: 0, reviewed: 0 };
      }
      platformBreakdown[p].total++;
      if (data.status === 'reviewed') {
        platformBreakdown[p].reviewed++;
      }
    });

    const totalRatings = allRatingsSnap.size;
    const summary = {
      totalRatings,
      totalReviews: userData.totalReviews || 0,
      averageApiScore: totalRatings > 0 ? parseFloat((totalApiScore / totalRatings).toFixed(2)) : null,
      averageUserScore: reviewedCount > 0 ? parseFloat((totalUserScore / reviewedCount).toFixed(2)) : null,
      pendingReviewCount,
      platformBreakdown,
    };

    res.status(200).json({ lastRating, summary });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});
