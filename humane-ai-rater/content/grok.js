/**
 * Content Script for Grok (x.com/i/grok)
 * Detects AI responses and injects HumaneBench rating buttons.
 *
 * Note: Grok runs within X (Twitter) and has fewer guardrails than other models,
 * making it an interesting contrast for humane technology assessment.
 */

(function () {
  const MODEL_NAME = 'Grok';
  const PROCESSED_ATTR = 'data-humane-processed';

  /**
   * Platform-specific configuration for Grok on X.com
   * Based on actual Grok DOM structure (Feb 2025)
   */
  const GROK_CONFIG = {
    // Primary selectors for Grok responses
    // Response containers have id="response-{uuid}" pattern
    responseSelectors: [
      '[id^="response-"]',                    // Main response container (id starts with "response-")
      '.message-bubble',                       // Message bubble wrapper
      '.response-content-markdown'             // Markdown content container
    ],

    // Content selectors within a response
    contentSelectors: [
      '.response-content-markdown',
      '.markdown',
      '.prose'
    ],

    // User message selectors (user prompts in Grok)
    userSelectors: [
      '[id^="prompt-"]',                       // User prompt containers likely follow similar pattern
      '[class*="user-message"]',
      '[class*="human-message"]',
      '[data-role="user"]'
    ],

    // Container that holds the conversation
    conversationSelectors: [
      '[role="main"]',
      'main',
      '[class*="conversation"]',
      '[class*="chat-container"]'
    ],

    // Action buttons area (to inject rate button near)
    actionButtonsSelector: '.action-buttons'
  };

  /**
   * Check if an element is a Grok response
   */
  function isGrokResponse(element) {
    // Check for response-* id pattern (primary identifier)
    const id = element.id || '';
    if (id.startsWith('response-')) {
      return true;
    }

    // Check for message-bubble class
    if (element.classList && element.classList.contains('message-bubble')) {
      return true;
    }

    // Check for response content markdown
    if (element.classList && element.classList.contains('response-content-markdown')) {
      return true;
    }

    // Check class names for response indicators
    const className = element.className || '';
    if (className.includes('response') || className.includes('assistant')) {
      return true;
    }

    return false;
  }

  /**
   * Check if response is still streaming
   */
  function isStreaming(element) {
    // Check common streaming indicators
    if (element.getAttribute('data-streaming') === 'true' ||
        element.getAttribute('data-is-streaming') === 'true' ||
        element.getAttribute('aria-busy') === 'true') {
      return true;
    }

    // Check for loading/typing indicators within the element
    const loadingIndicators = element.querySelectorAll(
      '[class*="loading"], [class*="typing"], [class*="streaming"], .animate-pulse, [class*="cursor"]'
    );
    if (loadingIndicators.length > 0) {
      // Check if there's an animated cursor (indicates still typing)
      for (const indicator of loadingIndicators) {
        const style = window.getComputedStyle(indicator);
        if (style.animationName && style.animationName !== 'none') {
          return true;
        }
      }
    }

    // Check parent containers for streaming state
    const parent = element.closest('[data-streaming="true"], [aria-busy="true"]');
    if (parent) return true;

    // Check if the response text is empty or very short (might still be loading)
    const content = element.querySelector('.response-content-markdown, .message-bubble');
    if (content && content.innerText.trim().length < 5) {
      return true;
    }

    return false;
  }

  /**
   * Extract the user prompt that precedes a Grok response.
   */
  function getUserPrompt(grokElement) {
    // Strategy 1: Get all response elements and find the user message before this one
    // In Grok, messages alternate between user and assistant
    const allResponses = document.querySelectorAll('[id^="response-"]');
    const allPrompts = document.querySelectorAll('[id^="prompt-"]');

    // Find the index of this response
    const responseIndex = Array.from(allResponses).indexOf(grokElement);

    // The corresponding user prompt should be at the same index or before
    if (allPrompts.length > 0 && responseIndex >= 0 && responseIndex < allPrompts.length) {
      return allPrompts[responseIndex].innerText.trim();
    }

    // Strategy 2: Walk backward through siblings to find user message
    let current = grokElement;
    while (current) {
      let prev = current.previousElementSibling;
      while (prev) {
        const prevId = prev.id || '';
        // Check if this is a user prompt
        if (prevId.startsWith('prompt-')) {
          return prev.innerText.trim();
        }
        // Check for user message selectors
        for (const userSel of GROK_CONFIG.userSelectors) {
          try {
            const userMsg = prev.matches(userSel) ? prev : prev.querySelector(userSel);
            if (userMsg) {
              return userMsg.innerText.trim();
            }
          } catch (e) { /* invalid selector */ }
        }
        prev = prev.previousElementSibling;
      }
      // Move up to parent
      current = current.parentElement;
      if (current === document.body) break;
    }

    // Strategy 3: Find the last user prompt on the page
    if (allPrompts.length > 0) {
      return allPrompts[allPrompts.length - 1].innerText.trim();
    }

    // Strategy 4: Look for any element that looks like a user message
    const potentialUserMessages = document.querySelectorAll('[class*="user"], [class*="human"], [class*="prompt"]');
    for (const msg of potentialUserMessages) {
      if (!msg.id.startsWith('response-') && msg.innerText.trim().length > 0) {
        return msg.innerText.trim();
      }
    }

    return '(User prompt not found)';
  }

  /**
   * Get the text content of a Grok response
   */
  function getResponseText(element) {
    // Try the specific content selectors in order of preference
    for (const selector of GROK_CONFIG.contentSelectors) {
      const content = element.querySelector(selector);
      if (content) {
        return content.innerText.trim();
      }
    }

    // Look for the message-bubble which contains the response text
    const messageBubble = element.querySelector('.message-bubble');
    if (messageBubble) {
      return messageBubble.innerText.trim();
    }

    // Fallback to the element's text, but filter out action button text
    const clone = element.cloneNode(true);
    const actionButtons = clone.querySelector('.action-buttons');
    if (actionButtons) actionButtons.remove();
    return clone.innerText.trim();
  }

  /**
   * Process a single Grok response element
   */
  function processResponse(responseElement) {
    if (responseElement.hasAttribute(PROCESSED_ATTR)) return;

    // Skip if still streaming
    if (isStreaming(responseElement)) return;

    responseElement.setAttribute(PROCESSED_ATTR, 'true');

    const aiResponse = getResponseText(responseElement);
    if (!aiResponse || aiResponse.length < 10) return;

    const userPrompt = getUserPrompt(responseElement);

    // Find the best insertion point - prefer action buttons area or message bubble
    const actionButtons = responseElement.querySelector(GROK_CONFIG.actionButtonsSelector);
    const messageBubble = responseElement.querySelector('.message-bubble');
    const insertionTarget = actionButtons || messageBubble || responseElement;

    humaneOverlay.injectRateButton(insertionTarget, userPrompt, aiResponse, MODEL_NAME);
  }

  /**
   * Scan the page for unprocessed Grok responses
   */
  function scanForResponses() {
    const seen = new Set();

    // Primary: Look for response-* id pattern (most reliable)
    const responseContainers = document.querySelectorAll('[id^="response-"]');
    responseContainers.forEach(el => {
      if (!seen.has(el) && !el.hasAttribute(PROCESSED_ATTR)) {
        seen.add(el);
        processResponse(el);
      }
    });

    // Fallback: try other response selectors
    for (const selector of GROK_CONFIG.responseSelectors) {
      try {
        const responses = document.querySelectorAll(selector);
        responses.forEach(el => {
          // Make sure we get the top-level response container
          const container = el.closest('[id^="response-"]') || el;
          if (!seen.has(container) && !container.hasAttribute(PROCESSED_ATTR)) {
            seen.add(container);
            processResponse(container);
          }
        });
      } catch (e) {
        // Invalid selector, skip
      }
    }
  }

  /**
   * Set up a MutationObserver to detect new responses
   */
  let scanTimeout = null;
  function observeNewResponses() {
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        // Debounce: wait for response to finish streaming/rendering
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(scanForResponses, 1500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Check if we're on a Grok page
   */
  function isGrokPage() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    // grok.com or x.com/i/grok or twitter.com/i/grok
    return host === 'grok.com' ||
           host.endsWith('grok.com') ||
           path.includes('/i/grok');
  }

  // Initial scan + observer
  function init() {
    if (!isGrokPage()) {
      // Not on Grok page, set up observer for SPA navigation
      const pathObserver = new MutationObserver(() => {
        if (isGrokPage()) {
          scanForResponses();
          observeNewResponses();
        }
      });
      pathObserver.observe(document.body, { childList: true, subtree: true });
      return;
    }

    // On Grok page - start scanning
    scanForResponses();
    observeNewResponses();

    // Re-scan periodically in case mutations are missed
    setInterval(scanForResponses, 5000);
  }

  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // X is an SPA, give it time to render
    setTimeout(init, 2500);
  }
})();
