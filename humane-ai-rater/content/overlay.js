/**
 * Overlay UI - Renders HumaneBench score display on AI chatbot pages.
 * Teal-themed interactive panel with dimension sliders and Submit button.
 */

class HumaneOverlay {
  constructor() {
    this.activePanel = null;
  }

  /**
   * Show a "Rate This" button near an AI response element
   */
  injectRateButton(responseElement, userPrompt, aiResponse, model) {
    // Don't inject if already present
    if (responseElement.querySelector('.humane-rate-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'humane-rate-btn';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
      Rate Humaneness
    `;
    btn.title = 'Evaluate this response with HumaneBench';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.startEvaluation(btn, userPrompt, aiResponse, model);
    });

    // Insert after the response element or append to it
    const container = document.createElement('div');
    container.className = 'humane-rate-container';
    container.appendChild(btn);
    responseElement.appendChild(container);
  }

  /**
   * Start evaluation - show loading, call background, show results
   */
  async startEvaluation(buttonElement, userPrompt, aiResponse, model) {
    // Show loading state
    const originalHTML = buttonElement.innerHTML;
    buttonElement.innerHTML = `
      <span class="humane-spinner"></span>
      Evaluating...
    `;
    buttonElement.disabled = true;

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'evaluate',
        userPrompt,
        aiResponse,
        model
      });

      if (result.error) {
        this.showError(buttonElement, result.error);
        buttonElement.innerHTML = originalHTML;
        buttonElement.disabled = false;
        return;
      }

      // Replace button with score panel
      const container = buttonElement.closest('.humane-rate-container');
      this.renderScorePanel(container, result, userPrompt, model);
    } catch (err) {
      this.showError(buttonElement, 'Evaluation failed. Check your API key.');
      buttonElement.innerHTML = originalHTML;
      buttonElement.disabled = false;
    }
  }

  /**
   * Format score for display with sign
   */
  formatScore(score) {
    const s = score.toFixed(1);
    return score > 0 ? `+${s}` : s;
  }

  /**
   * Render the full interactive score panel
   */
  renderScorePanel(container, evaluation, userPrompt, model) {
    const overallScore = evaluation.overallScore ??
      (evaluation.principles.reduce((s, p) => s + p.score, 0) / evaluation.principles.length);
    const scoreColor = getScoreColor(overallScore);
    const scoreLabel = getScoreLabel(overallScore);

    // User-editable scores (start as copy of AI scores)
    const userScores = {};
    evaluation.principles.forEach(p => {
      userScores[p.code] = p.score;
    });

    container.innerHTML = '';
    container.className = 'humane-score-panel';

    const panel = document.createElement('div');
    panel.className = 'humane-panel-inner';

    const dotScores = [-1, -0.5, 0, 0.5, 1];
    const dotLabels = ['-1', '-.5', '0', '.5', '1'];

    panel.innerHTML = `
      <div class="humane-panel-header">
        <div class="humane-panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          HumaneScore
        </div>
        <button class="humane-close-btn" title="Close">&times;</button>
      </div>
      <div class="humane-overall-row">
        <div class="humane-overall-score" style="color: ${scoreColor}" id="humane-overall-score">
          ${this.formatScore(overallScore)}
        </div>
        <div class="humane-overall-meta">
          <span class="humane-score-badge" id="humane-score-badge" style="background: ${scoreColor}20; color: ${scoreColor}; border: 1px solid ${scoreColor}40">
            ${scoreLabel}
          </span>
          <span class="humane-model-tag">${model}</span>
          ${evaluation.confidence ? `<span class="humane-confidence">${(evaluation.confidence * 100).toFixed(0)}% confidence</span>` : ''}
        </div>
      </div>
      <div class="humane-dimensions-list">
        ${evaluation.principles.map(p => {
          const color = getScoreColor(p.score);
          const dotIndex = Math.max(0, Math.min(4, Math.round((p.score + 1) * 2)));
          const fillPct = ((p.score + 1) / 2) * 100;
          const escapedRationale = (p.rationale || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          return `
            <div class="humane-dim-row" data-code="${p.code}" title="${escapedRationale}">
              <div class="humane-dim-name">${p.name}</div>
              <div class="humane-dim-slider">
                <div class="humane-dim-track">
                  <div class="humane-dim-fill" style="width: ${fillPct}%"></div>
                </div>
                <div class="humane-dim-dots">
                  ${dotScores.map((ds, i) => {
                    let cls = 'humane-dim-dot';
                    if (i < dotIndex) cls += ' passed';
                    if (i === dotIndex) cls += ' active';
                    return `<button class="${cls}" data-code="${p.code}" data-score="${ds}" data-idx="${i}"></button>`;
                  }).join('')}
                </div>
              </div>
              <span class="humane-dim-score" style="color: ${color}">${this.formatScore(p.score)}</span>
            </div>
            <div class="humane-dim-labels">
              ${dotLabels.map(l => `<span>${l}</span>`).join('')}
            </div>
          `;
        }).join('')}
      </div>
      ${evaluation.analysis ? `
        <div class="humane-analysis">
          <details>
            <summary>View Analysis</summary>
            <p>${evaluation.analysis.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </details>
        </div>
      ` : ''}
      <div class="humane-panel-footer">
        <div class="humane-footer-left">
          <div class="humane-binary-rating">
            <button class="humane-thumb humane-thumb-up" data-vote="up" title="Humane">&#128077;</button>
            <button class="humane-thumb humane-thumb-down" data-vote="down" title="Not humane">&#128078;</button>
          </div>
          <button class="humane-submit-btn" id="humane-submit-btn">Submit</button>
        </div>
        <div class="humane-powered-by">Powered by HumaneBench</div>
      </div>
    `;

    container.appendChild(panel);

    // Close button
    panel.querySelector('.humane-close-btn').addEventListener('click', () => {
      container.remove();
    });

    // Interactive dot clicks
    panel.querySelectorAll('.humane-dim-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        const code = dot.dataset.code;
        const score = parseFloat(dot.dataset.score);
        userScores[code] = score;
        this.updateDimRow(panel, code, score);
        this.updateOverallDisplay(panel, userScores);
      });
    });

    // Binary thumb voting
    let binaryVote = null;
    panel.querySelectorAll('.humane-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const vote = thumb.dataset.vote;
        if (binaryVote === vote) {
          // Deselect
          thumb.classList.remove('active');
          binaryVote = null;
        } else {
          panel.querySelectorAll('.humane-thumb').forEach(t => t.classList.remove('active'));
          thumb.classList.add('active');
          binaryVote = vote;
        }
      });
    });

    // Submit button
    panel.querySelector('.humane-submit-btn').addEventListener('click', async () => {
      const submitBtn = panel.querySelector('.humane-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      try {
        const ratingId = evaluation.ratingId;
        const userPrinciples = evaluation.principles.map(p => ({
          code: p.code,
          name: p.name,
          score: userScores[p.code],
          rationale: p.rationale
        }));
        const userOverall = userPrinciples.reduce((sum, p) => sum + p.score, 0) / userPrinciples.length;

        await chrome.runtime.sendMessage({
          type: 'submitUserRating',
          ratingId,
          userScores,
          userOverallScore: parseFloat(userOverall.toFixed(2)),
          userPrinciples,
          binaryVote
        });

        submitBtn.textContent = 'Submitted';
        submitBtn.classList.add('humane-submit-success');
      } catch (err) {
        console.error('Submit failed:', err);
        submitBtn.textContent = 'Submit Failed';
        submitBtn.classList.add('humane-submit-error');
        setTimeout(() => {
          submitBtn.textContent = 'Submit';
          submitBtn.classList.remove('humane-submit-error');
          submitBtn.disabled = false;
        }, 2000);
      }
    });
  }

  /**
   * Update a single dimension row after user clicks a dot
   */
  updateDimRow(panel, code, score) {
    const row = panel.querySelector(`.humane-dim-row[data-code="${code}"]`);
    if (!row) return;

    const dotIndex = Math.max(0, Math.min(4, Math.round((score + 1) * 2)));
    const fillPct = ((score + 1) / 2) * 100;
    const color = getScoreColor(score);

    // Update fill bar
    const fill = row.querySelector('.humane-dim-fill');
    if (fill) fill.style.width = `${fillPct}%`;

    // Update dots
    row.querySelectorAll('.humane-dim-dot').forEach(dot => {
      const idx = parseInt(dot.dataset.idx);
      dot.className = 'humane-dim-dot';
      if (idx < dotIndex) dot.classList.add('passed');
      if (idx === dotIndex) dot.classList.add('active');
    });

    // Update score display
    const scoreEl = row.querySelector('.humane-dim-score');
    if (scoreEl) {
      scoreEl.textContent = this.formatScore(score);
      scoreEl.style.color = color;
    }
  }

  /**
   * Recalculate and update overall score display
   */
  updateOverallDisplay(panel, userScores) {
    const codes = Object.keys(userScores);
    const avg = codes.reduce((sum, c) => sum + userScores[c], 0) / codes.length;
    const color = getScoreColor(avg);
    const label = getScoreLabel(avg);

    const scoreEl = panel.querySelector('#humane-overall-score');
    if (scoreEl) {
      scoreEl.textContent = this.formatScore(avg);
      scoreEl.style.color = color;
    }

    const badge = panel.querySelector('#humane-score-badge');
    if (badge) {
      badge.textContent = label;
      badge.style.background = `${color}20`;
      badge.style.color = color;
      badge.style.borderColor = `${color}40`;
    }
  }

  /**
   * Show error toast
   */
  showError(element, message) {
    const toast = document.createElement('div');
    toast.className = 'humane-toast humane-toast-error';
    toast.textContent = message;
    element.closest('.humane-rate-container')?.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
}

// Global overlay instance
const humaneOverlay = new HumaneOverlay();
