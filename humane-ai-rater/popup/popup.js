/**
 * Popup Script - Humane AI Rater
 * Dimension sliders, leaderboard, recent ratings, settings.
 */

document.addEventListener('DOMContentLoaded', () => {
  initData();
  initTabs();
  initMoreToggle();
  initSettings();
  initHistory();
  initTimeFilter();
  loadLeaderboard();
  loadRecent();
  loadApiKey();
});

// ─── Constants ───────────────────────────────────

const DIM_LABELS = [
  'Empathy', 'Meaningful', 'Supportive', 'Secure',
  'Honest', 'Respectful', 'Transparent', 'Inclusive'
];

const DIM_FULL_NAMES = [
  'Respect User Attention', 'Enable Meaningful Choices',
  'Enhance Human Capabilities', 'Protect Dignity & Safety',
  'Foster Healthy Relationships', 'Prioritize Long-term Wellbeing',
  'Be Transparent & Honest', 'Design for Equity & Inclusion'
];

const URL_TO_MODEL = [
  { pattern: 'chatgpt.com', model: 'ChatGPT' },
  { pattern: 'chat.openai.com', model: 'ChatGPT' },
  { pattern: 'claude.ai', model: 'Claude' },
  { pattern: 'grok.com', model: 'Grok' },
  { pattern: 'x.com', model: 'Grok' },
  { pattern: 'twitter.com', model: 'Grok' },
  { pattern: 'chat.deepseek.com', model: 'Deepseek' }
];

let allRatings = [];
let currentChatbot = null;

// ─── Score Helpers ──────────────────────────────

function getColor(score) {
  if (score >= 0.75) return '#10b981';
  if (score >= 0.0)  return '#f59e0b';
  if (score >= -0.5) return '#f97316';
  return '#ef4444';
}

function getLabel(score) {
  if (score >= 0.75) return 'Exemplary';
  if (score >= 0.0)  return 'Acceptable';
  if (score >= -0.5) return 'Concerning';
  return 'Violation';
}

function getBgClass(score) {
  if (score >= 1.0)  return 'bg-exemplary';
  if (score >= 0.5)  return 'bg-acceptable';
  if (score >= -0.5) return 'bg-concerning';
  return 'bg-violation';
}

/** Format -1..1 score for display with sign */
function formatScore(score) {
  const s = score.toFixed(1);
  return score > 0 ? `+${s}` : s;
}

// ─── Data & Dimensions ──────────────────────────

async function detectCurrentChatbot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const hostname = new URL(tab.url).hostname;
      const match = URL_TO_MODEL.find(m => hostname.includes(m.pattern));
      if (match) return match.model;
    }
  } catch (err) { /* ignore */ }
  return null;
}

async function initData() {
  try {
    allRatings = await sendMessage({ type: 'getRatings' }) || [];
    currentChatbot = await detectCurrentChatbot();
  } catch (err) {
    allRatings = [];
  }
  updateScoreCircle();
  renderDimensions();
}

function getCircleColor(score) {
  if (score >= 0.5)  return '#10b981';
  if (score >= 0)    return '#f59e0b';
  if (score >= -0.5) return '#f97316';
  return '#ef4444';
}

function updateScoreCircle() {
  const circle = document.getElementById('scoreCircle');
  const valueEl = document.getElementById('scoreCircleValue');
  const labelEl = document.getElementById('scoreCircleLabel');

  const ratings = getRelevantRatings();
  labelEl.textContent = currentChatbot || '';

  if (!ratings || ratings.length === 0) {
    valueEl.textContent = '--';
    circle.style.background = '#d1d5db';
    return;
  }

  const avg = ratings.reduce((sum, r) => sum + r.overallScore, 0) / ratings.length;
  valueEl.textContent = formatScore(avg);
  circle.style.background = getCircleColor(avg);
}

function getRelevantRatings() {
  return currentChatbot
    ? allRatings.filter(r => r.model === currentChatbot)
    : allRatings;
}

function renderDimensions() {
  const container = document.getElementById('dimensionsContainer');
  const ratings = getRelevantRatings();

  if (!ratings || ratings.length === 0) {
    container.innerHTML = DIM_LABELS.map((label, i) =>
      renderSlider(label, null, DIM_FULL_NAMES[i])
    ).join('');
    return;
  }

  const dimAvgs = Array(8).fill(0);
  ratings.forEach(r => {
    if (r.principles) {
      r.principles.forEach((p, i) => { dimAvgs[i] += p.score; });
    }
  });
  dimAvgs.forEach((_, i) => { dimAvgs[i] /= ratings.length; });

  container.innerHTML = dimAvgs.map((avg, i) =>
    renderSlider(DIM_LABELS[i], avg, DIM_FULL_NAMES[i])
  ).join('');
}

function renderSlider(label, value, tooltip) {
  const hasData = value !== null && value !== undefined;
  const dotLabels = ['-1', '-.5', '0', '.5', '1'];
  // Map -1..1 to dot index 0..4
  const dotIndex = hasData ? Math.max(0, Math.min(4, Math.round((value + 1) * 2))) : -1;
  const fillPct = hasData ? Math.max(0, Math.min(100, ((value + 1) / 2) * 100)) : 0;

  let dotsHtml = '';
  for (let i = 0; i < 5; i++) {
    let cls = 'slider-dot';
    if (hasData && i < dotIndex) cls += ' passed';
    if (hasData && i === dotIndex) cls += ' active';
    dotsHtml += `<div class="${cls}"></div>`;
  }

  return `
    <div class="slider-group${hasData ? '' : ' empty'}" title="${tooltip}">
      <div class="slider-title">${label}</div>
      <div class="slider-track-wrapper">
        <div class="slider-track">
          <div class="slider-fill" style="width: ${fillPct}%"></div>
        </div>
        <div class="slider-dots">${dotsHtml}</div>
      </div>
      <div class="slider-numbers">
        ${dotLabels.map(l => `<span>${l}</span>`).join('')}
      </div>
    </div>
  `;
}

// ─── Tabs ────────────────────────────────────────

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

// ─── More Toggle ─────────────────────────────────

function initMoreToggle() {
  const btn = document.getElementById('moreBtn');
  const section = document.getElementById('expandedSection');

  btn.addEventListener('click', () => {
    const isOpen = section.classList.toggle('open');
    btn.textContent = isOpen ? 'less...' : 'more...';
  });
}

// ─── Settings ────────────────────────────────────

function initSettings() {
  const overlay = document.getElementById('settingsOverlay');

  document.getElementById('gearBtn').addEventListener('click', () => {
    overlay.classList.add('open');
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });

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
      allRatings = [];
      updateScoreCircle();
      renderDimensions();
      loadLeaderboard();
      loadRecent();
    } catch (err) {
      alert('Failed to clear data');
    }
  });
}

async function loadApiKey() {
  try {
    const result = await sendMessage({ type: 'getApiKey' });
    if (result.apiKey) {
      document.getElementById('apiKeyInput').value = result.apiKey;
      showKeyStatus('API key saved', 'success');
    }
  } catch (err) { /* ignore */ }
}

function showKeyStatus(message, type) {
  const el = document.getElementById('keyStatus');
  el.textContent = message;
  el.className = `key-status ${type}`;
}

// ─── Leaderboard ─────────────────────────────────

async function loadLeaderboard() {
  const container = document.getElementById('leaderboardContainer');

  try {
    const leaderboard = await sendMessage({ type: 'getLeaderboard' });

    if (!leaderboard || Object.keys(leaderboard).length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No ratings yet.</p>
          <p class="muted">Visit ChatGPT or Claude and rate some responses!</p>
        </div>`;
      return;
    }

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
            <div class="lb-score" style="color: ${color}">${formatScore(entry.avgScore)}</div>
            <div class="lb-label">${label}</div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading leaderboard</p></div>`;
  }
}

// ─── Recent Ratings ──────────────────────────────

async function loadRecent() {
  const container = document.getElementById('recentContainer');

  try {
    const ratings = await sendMessage({ type: 'getRatings' });

    if (!ratings || ratings.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No ratings yet.</p></div>`;
      return;
    }

    const shortLabels = ['Emp', 'Mean', 'Supp', 'Sec', 'Hon', 'Resp', 'Trns', 'Incl'];

    container.innerHTML = ratings.slice(0, 10).map((rating, idx) => {
      const color = getColor(rating.overallScore);

      return `
        <div class="recent-card" data-rating-idx="${idx}">
          <div class="recent-header">
            <span class="recent-model">${rating.model}</span>
            <div class="recent-header-right">
              <span class="recent-score" style="color: ${color}">${formatScore(rating.overallScore)}</span>
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
                <div class="recent-principle ${bgClass}" title="${p.name}: ${formatScore(p.score)}">
                  <span class="p-score" style="color: ${pc}">${formatScore(p.score)}</span>
                  <span class="p-name">${shortLabels[i]}</span>
                </div>`;
            }).join('')}
          </div>
          <div class="recent-time">${timeAgo(rating.timestamp)}</div>
        </div>`;
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

// ─── Helpers ─────────────────────────────────────

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
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

async function screenshotCard(cardElement, shareBtn) {
  const originalHTML = shareBtn.innerHTML;

  try {
    shareBtn.innerHTML = `<span class="share-spinner"></span>`;
    shareBtn.disabled = true;
    shareBtn.style.visibility = 'hidden';

    const canvas = await html2canvas(cardElement, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false
    });

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
  const existing = document.querySelector('.copy-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

// ─── History Panel ───────────────────────────────

function initHistory() {
  const overlay = document.getElementById('historyOverlay');

  document.getElementById('scoreCircle').addEventListener('click', () => {
    overlay.classList.add('open');
    populateModelFilter();
    if (currentChatbot) {
      const pills = document.querySelectorAll('#modelFilter .pill');
      pills.forEach(p => {
        p.classList.toggle('active', p.dataset.model === currentChatbot);
      });
    }
    loadHistory();
  });

  document.getElementById('closeHistoryBtn').addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
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
  bigScore.textContent = formatScore(avg);
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

  const dimAvgs = Array(8).fill(0);
  ratings.forEach(r => {
    if (r.principles) {
      r.principles.forEach((p, i) => { dimAvgs[i] += p.score; });
    }
  });
  dimAvgs.forEach((_, i) => { dimAvgs[i] /= ratings.length; });

  container.innerHTML = dimAvgs.map((avg, i) => {
    const pct = ((avg + 1) / 2) * 100;
    const color = getColor(avg);
    return `
      <div class="dim-row">
        <span class="dim-name">${DIM_FULL_NAMES[i]}</span>
        <div class="dim-bar-track">
          <div class="dim-bar-fill" style="width: ${pct}%; background: ${color}"></div>
        </div>
        <span class="dim-value" style="color: ${color}">${formatScore(avg)}</span>
      </div>`;
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
          <span class="history-item-score" style="color: ${color}">${formatScore(r.overallScore)}</span>
        </div>
        <div class="history-item-prompt">${escapeHtml(r.userPrompt)}</div>
        <div class="history-item-time">${timeAgo(r.timestamp)}</div>
      </div>`;
  }).join('');
}
