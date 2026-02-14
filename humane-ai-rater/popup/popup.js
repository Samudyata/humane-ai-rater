/**
 * Popup Script - Leaderboard, Recent Ratings, and Settings
 */

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadLeaderboard();
  loadRecent();
  loadApiKey();
  setupEventListeners();
  initScoreCircle();
  initFlip();
  initTimeFilter();
});

// --- Tab Navigation ---

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// --- Leaderboard ---

async function loadLeaderboard() {
  const container = document.getElementById('leaderboardContainer');

  try {
    const leaderboard = await sendMessage({ type: 'getLeaderboard' });

    if (!leaderboard || Object.keys(leaderboard).length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No ratings yet.</p>
          <p class="muted">Visit ChatGPT or Claude and rate some responses!</p>
        </div>
      `;
      return;
    }

    // Sort by average score descending
    const sorted = Object.entries(leaderboard)
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.avgScore - a.avgScore);

    container.innerHTML = sorted.map((entry, i) => {
      const color = getColor(entry.avgScore);
      const label = getLabel(entry.avgScore);
      return `
        <div class="leaderboard-card">
          <div class="lb-rank rank-${i + 1}">#${i + 1}</div>
          <div class="lb-info">
            <div class="lb-model">${entry.model}</div>
            <div class="lb-count">${entry.count} rating${entry.count !== 1 ? 's' : ''}</div>
          </div>
          <div>
            <div class="lb-score" style="color: ${color}">
              ${entry.avgScore > 0 ? '+' : ''}${entry.avgScore.toFixed(2)}
            </div>
            <div class="lb-label">${label}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading leaderboard</p></div>`;
  }
}

// --- Recent Ratings ---

async function loadRecent() {
  const container = document.getElementById('recentContainer');

  try {
    const ratings = await sendMessage({ type: 'getRatings' });

    if (!ratings || ratings.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No ratings yet.</p></div>`;
      return;
    }

    // Show last 10
    container.innerHTML = ratings.slice(0, 10).map((rating, idx) => {
      const color = getColor(rating.overallScore);
      const shortLabels = ['Attn', 'Choice', 'Capab', 'Safety', 'Relat', 'Well', 'Trans', 'Equit'];

      return `
        <div class="recent-card" data-rating-idx="${idx}">
          <div class="recent-header">
            <span class="recent-model">${rating.model}</span>
            <div class="recent-header-right">
              <span class="recent-score" style="color: ${color}">
                ${rating.overallScore > 0 ? '+' : ''}${rating.overallScore.toFixed(2)}
              </span>
              <button class="share-btn" data-idx="${idx}" title="Copy as image">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                  <polyline points="16 6 12 2 8 6"/>
                  <line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="recent-prompt" title="${escapeHtml(rating.userPrompt)}">
            ${escapeHtml(rating.userPrompt)}
          </div>
          <div class="recent-principles">
            ${rating.principles.map((p, i) => {
              const pc = getColor(p.score);
              const bgClass = getBgClass(p.score);
              return `
                <div class="recent-principle ${bgClass}" title="${p.name}: ${p.score}">
                  <span class="p-score" style="color: ${pc}">${p.score > 0 ? '+' : ''}${p.score}</span>
                  <span class="p-name">${shortLabels[i]}</span>
                </div>
              `;
            }).join('')}
          </div>
          <div class="recent-time">${timeAgo(rating.timestamp)}</div>
        </div>
      `;
    }).join('');

    // Attach share button listeners
    container.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = btn.closest('.recent-card');
        await screenshotCard(card, btn);
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading ratings</p></div>`;
  }
}

// --- Settings ---

async function loadApiKey() {
  try {
    const result = await sendMessage({ type: 'getApiKey' });
    if (result.apiKey) {
      document.getElementById('apiKeyInput').value = result.apiKey;
      showKeyStatus('API key saved', 'success');
    }
  } catch (err) {
    // Ignore
  }
}

function setupEventListeners() {
  // Save API key
  document.getElementById('saveKeyBtn').addEventListener('click', async () => {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) {
      showKeyStatus('Please enter an API key', 'error');
      return;
    }

    try {
      await sendMessage({ type: 'setApiKey', apiKey: key });
      showKeyStatus('API key saved!', 'success');
    } catch (err) {
      showKeyStatus('Failed to save key', 'error');
    }
  });

  // Clear data
  document.getElementById('clearDataBtn').addEventListener('click', async () => {
    if (!confirm('Clear all ratings and leaderboard data?')) return;

    try {
      await sendMessage({ type: 'clearData' });
      loadLeaderboard();
      loadRecent();
    } catch (err) {
      alert('Failed to clear data');
    }
  });
}

function showKeyStatus(message, type) {
  const el = document.getElementById('keyStatus');
  el.textContent = message;
  el.className = `key-status ${type}`;
}

// --- Helpers ---

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function getColor(score) {
  if (score >= 0.75) return '#10b981';
  if (score >= 0.0) return '#f59e0b';
  if (score >= -0.5) return '#f97316';
  return '#ef4444';
}

function getLabel(score) {
  if (score >= 0.75) return 'Exemplary';
  if (score >= 0.0) return 'Acceptable';
  if (score >= -0.5) return 'Concerning';
  return 'Violation';
}

function getBgClass(score) {
  if (score >= 1.0) return 'bg-exemplary';
  if (score >= 0.5) return 'bg-acceptable';
  if (score >= -0.5) return 'bg-concerning';
  return 'bg-violation';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

async function screenshotCard(cardElement, shareBtn) {
  const originalHTML = shareBtn.innerHTML;

  try {
    // Show loading state
    shareBtn.innerHTML = `<span class="share-spinner"></span>`;
    shareBtn.disabled = true;

    // Hide the share button during capture
    shareBtn.style.visibility = 'hidden';

    // Capture with html2canvas
    const canvas = await html2canvas(cardElement, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false
    });

    // Restore share button
    shareBtn.style.visibility = '';

    // Convert to blob
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'humane-score.png', { type: 'image/png' });

    // Get score info for share text
    const scoreEl = cardElement.querySelector('.recent-score');
    const modelEl = cardElement.querySelector('.recent-model');
    const score = scoreEl ? scoreEl.textContent.trim() : '';
    const model = modelEl ? modelEl.textContent.trim() : 'AI';
    const shareText = `${model} scored ${score} on the HumaneBench humaneness rating! Check how humane your AI is.`;

    // Try Web Share API first (works on mobile + some desktop)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: 'HumaneBench Score',
        text: shareText,
        files: [file]
      });
      showToast('Shared!');
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      showToast('Copied to Clipboard!');
    }

    // Success feedback
    shareBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    shareBtn.classList.add('share-success');

    setTimeout(() => {
      shareBtn.innerHTML = originalHTML;
      shareBtn.disabled = false;
      shareBtn.classList.remove('share-success');
    }, 1500);

  } catch (err) {
    // User cancelled share dialog - not an error
    if (err.name === 'AbortError') {
      shareBtn.innerHTML = originalHTML;
      shareBtn.disabled = false;
      return;
    }

    console.error('Share failed:', err);
    shareBtn.style.visibility = '';
    shareBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    setTimeout(() => {
      shareBtn.innerHTML = originalHTML;
      shareBtn.disabled = false;
    }, 1500);
  }
}

function showToast(message) {
  // Remove any existing toast
  const existing = document.querySelector('.copy-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

function timeAgo(isoString) {
  const now = new Date();
  const date = new Date(isoString);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// --- Score Circle & Flip History ---

let allRatings = [];
let currentChatbot = null;

const URL_TO_MODEL = [
  { pattern: 'chatgpt.com', model: 'ChatGPT' },
  { pattern: 'chat.openai.com', model: 'ChatGPT' },
  { pattern: 'claude.ai', model: 'Claude' },
  { pattern: 'grok.com', model: 'Grok' },
  { pattern: 'x.com', model: 'Grok' },
  { pattern: 'twitter.com', model: 'Grok' },
  { pattern: 'chat.deepseek.com', model: 'Deepseek' }
];

function getCircleColor(score) {
  if (score >= 0.5) return '#10b981';   // green
  if (score >= 0) return '#f59e0b';     // yellow
  if (score >= -0.5) return '#f97316';  // orange
  return '#ef4444';                      // red
}

async function detectCurrentChatbot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const hostname = new URL(tab.url).hostname;
      const match = URL_TO_MODEL.find(m => hostname.includes(m.pattern));
      if (match) return match.model;
    }
  } catch (err) {
    // Ignore - tab access may not be available
  }
  return null;
}

async function initScoreCircle() {
  try {
    allRatings = await sendMessage({ type: 'getRatings' }) || [];
    currentChatbot = await detectCurrentChatbot();
    updateScoreCircle();
  } catch (err) {
    allRatings = [];
  }
}

function updateScoreCircle() {
  const circle = document.getElementById('scoreCircle');
  const valueEl = document.getElementById('scoreCircleValue');
  const labelEl = document.getElementById('scoreCircleLabel');

  // Filter to current chatbot if detected
  const ratings = currentChatbot
    ? allRatings.filter(r => r.model === currentChatbot)
    : allRatings;

  labelEl.textContent = currentChatbot || '';

  if (!ratings || ratings.length === 0) {
    valueEl.textContent = '--';
    circle.style.background = '#d1d5db';
    return;
  }

  const avg = ratings.reduce((sum, r) => sum + r.overallScore, 0) / ratings.length;
  valueEl.textContent = avg.toFixed(1);
  circle.style.background = getCircleColor(avg);
}

function initFlip() {
  document.getElementById('scoreCircle').addEventListener('click', () => {
    document.getElementById('flipCard').classList.add('flipped');
    populateModelFilter();
    // Auto-select the current chatbot in the model filter
    if (currentChatbot) {
      const pills = document.querySelectorAll('#modelFilter .pill');
      pills.forEach(p => {
        p.classList.toggle('active', p.dataset.model === currentChatbot);
      });
    }
    loadHistory();
  });

  document.getElementById('backBtn').addEventListener('click', () => {
    document.getElementById('flipCard').classList.remove('flipped');
  });
}

function initTimeFilter() {
  document.querySelectorAll('#timeFilter .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#timeFilter .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      loadHistory();
    });
  });
}

function populateModelFilter() {
  const container = document.getElementById('modelFilter');
  const models = [...new Set(allRatings.map(r => r.model))];

  container.innerHTML = '<button class="pill active" data-model="all">All</button>';
  models.forEach(model => {
    container.innerHTML += `<button class="pill" data-model="${escapeHtml(model)}">${escapeHtml(model)}</button>`;
  });

  container.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      loadHistory();
    });
  });
}

function getFilteredRatings() {
  const modelFilter = document.querySelector('#modelFilter .pill.active')?.dataset.model || 'all';
  const timeFilter = document.querySelector('#timeFilter .pill.active')?.dataset.time || 'all';

  let filtered = [...allRatings];

  if (modelFilter !== 'all') {
    filtered = filtered.filter(r => r.model === modelFilter);
  }

  if (timeFilter !== 'all') {
    const days = parseInt(timeFilter);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    filtered = filtered.filter(r => new Date(r.timestamp) >= cutoff);
  }

  return filtered;
}

function loadHistory() {
  const filtered = getFilteredRatings();
  renderHistorySummary(filtered);
  renderHistoryDimensions(filtered);
  renderHistoryList(filtered);
}

function renderHistorySummary(ratings) {
  const bigCircle = document.getElementById('historyBigCircle');
  const bigScore = document.getElementById('historyBigScore');
  const countEl = document.getElementById('historyCount');
  const labelEl = document.getElementById('historyLabel');

  if (ratings.length === 0) {
    bigScore.textContent = '--';
    bigCircle.style.background = '#d1d5db';
    countEl.textContent = '0';
    labelEl.textContent = 'N/A';
    return;
  }

  const avg = ratings.reduce((sum, r) => sum + r.overallScore, 0) / ratings.length;
  bigScore.textContent = (avg > 0 ? '+' : '') + avg.toFixed(2);
  bigCircle.style.background = getCircleColor(avg);
  countEl.textContent = ratings.length;
  labelEl.textContent = getLabel(avg);
}

function renderHistoryDimensions(ratings) {
  const container = document.getElementById('historyDimensions');

  if (ratings.length === 0) {
    container.innerHTML = '';
    return;
  }

  const dimNames = [
    'Respect Attention', 'Meaningful Choices', 'Enhance Capabilities',
    'Dignity & Safety', 'Healthy Relationships', 'Long-term Wellbeing',
    'Transparency & Honesty', 'Equity & Inclusion'
  ];

  const dimAvgs = Array(8).fill(0);
  ratings.forEach(r => {
    if (r.principles) {
      r.principles.forEach((p, i) => { dimAvgs[i] += p.score; });
    }
  });
  dimAvgs.forEach((_, i) => { dimAvgs[i] = dimAvgs[i] / ratings.length; });

  container.innerHTML = dimAvgs.map((avg, i) => {
    const pct = ((avg + 1) / 2) * 100; // map -1..1 to 0%..100%
    const color = getColor(avg);
    return `
      <div class="dim-row">
        <span class="dim-name">${dimNames[i]}</span>
        <div class="dim-bar-track">
          <div class="dim-bar-fill" style="width: ${pct}%; background: ${color}"></div>
        </div>
        <span class="dim-value" style="color: ${color}">${avg > 0 ? '+' : ''}${avg.toFixed(2)}</span>
      </div>
    `;
  }).join('');
}

function renderHistoryList(ratings) {
  const container = document.getElementById('historyList');

  if (ratings.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No ratings for this filter.</p></div>';
    return;
  }

  container.innerHTML = ratings.map(r => {
    const color = getColor(r.overallScore);
    return `
      <div class="history-item">
        <div class="history-item-header">
          <span class="history-item-model">${escapeHtml(r.model)}</span>
          <span class="history-item-score" style="color: ${color}">
            ${r.overallScore > 0 ? '+' : ''}${r.overallScore.toFixed(2)}
          </span>
        </div>
        <div class="history-item-prompt">${escapeHtml(r.userPrompt)}</div>
        <div class="history-item-time">${timeAgo(r.timestamp)}</div>
      </div>
    `;
  }).join('');
}
