/**
 * Content Script for Claude (claude.ai)
 * Detects AI responses and injects HumaneBench rating buttons.
 * Updated Feb 2025 for new Claude.ai DOM structure.
 */

(function () {
  const MODEL_NAME = 'Claude';
  const PROCESSED_ATTR = 'data-humane-processed';

  /**
   * Claude.ai DOM selectors (Feb 2025)
   */
  const CLAUDE_CONFIG = {
    // Response content selectors
    responseSelectors: [
      '.standard-markdown',                    // New Claude response container
      '.font-claude-response-body',            // Response text paragraphs
      '[data-testid="chat-message-content"]',  // Legacy selector
      '.prose'                                 // Legacy selector
    ],

    // User message selectors
    userSelectors: [
      '.font-user-message',                    // User message text
      '[data-testid="user-message"]'           // Legacy
    ],

    // Grid position indicates assistant (row-start-2 is typically assistant)
    assistantGridClass: 'row-start-2'
  };

  /**
   * Determine if an element is an assistant (not human) message.
   */
  function isAssistantMessage(element) {
    // Strategy 1: Check for row-start-2 class (Claude uses grid layout)
    // Assistant messages are typically in row-start-2
    const gridParent = element.closest('[class*="row-start"]');
    if (gridParent) {
      const className = gridParent.className || '';
      if (className.includes('row-start-2')) return true;
      if (className.includes('row-start-1') && !element.closest('.standard-markdown')) return false;
    }

    // Strategy 2: Check for standard-markdown class (assistant responses)
    if (element.classList.contains('standard-markdown') ||
        element.querySelector('.standard-markdown')) {
      return true;
    }

    // Strategy 3: Check for font-claude-response-body (response text)
    if (element.querySelector('.font-claude-response-body') ||
        element.classList.contains('font-claude-response-body')) {
      return true;
    }

    // Strategy 4: Legacy - check for .prose
    const hasProse = element.querySelector('.prose') || element.classList.contains('prose');
    if (hasProse) return true;

    // Strategy 5: Check parent/ancestor for role indicators
    let turnContainer = element.closest('[data-testid]');
    if (turnContainer) {
      const testId = turnContainer.getAttribute('data-testid');
      if (testId && (testId.includes('human') || testId.includes('user'))) return false;
      if (testId && testId.includes('assistant')) return true;
    }

    // Strategy 6: Check for action buttons (copy, retry) that only appear on assistant messages
    const messageRow = element.closest('[class*="grid"]') || element.parentElement;
    if (messageRow) {
      const hasActionButtons = messageRow.querySelector('button[aria-label*="opy"]')
        || messageRow.querySelector('button[aria-label*="etry"]');
      if (hasActionButtons) return true;
    }

    return false;
  }

  /**
   * Extract the user prompt that precedes an assistant response.
   */
  function getUserPrompt(assistantElement) {
    // Strategy 1: Find all standard-markdown elements (responses) and user messages
    // Walk backward from this response to find the preceding user message
    const allResponses = document.querySelectorAll('.standard-markdown');
    const responseIndex = Array.from(allResponses).indexOf(assistantElement);

    // Strategy 2: Walk up the DOM and find the previous message block
    let current = assistantElement;
    while (current && current !== document.body) {
      // Go up to find the message container (usually has grid classes)
      const container = current.closest('[class*="grid"]');
      if (container && container.parentElement) {
        let prev = container.previousElementSibling;
        while (prev) {
          // Look for user message content
          const userText = prev.querySelector('.font-user-message') ||
                          prev.querySelector('[data-testid="user-message"]') ||
                          prev.querySelector('p');
          if (userText) {
            const text = userText.textContent?.trim();
            if (text && text.length > 0 && text.length < 5000) return text;
          }
          // Also check if prev itself contains text (user messages might be simpler)
          if (!prev.querySelector('.standard-markdown')) {
            const text = prev.textContent?.trim();
            if (text && text.length > 0 && text.length < 5000 && text.length < 2000) {
              return text;
            }
          }
          prev = prev.previousElementSibling;
        }
      }
      current = current.parentElement;
    }

    // Strategy 3: Find user input area and get its content (for single-turn)
    const userMessages = document.querySelectorAll('.font-user-message, [data-testid="user-message"]');
    if (userMessages.length > 0) {
      // Get the last user message before this response
      for (let i = userMessages.length - 1; i >= 0; i--) {
        const text = userMessages[i].textContent?.trim();
        if (text && text.length > 0) return text;
      }
    }

    // Strategy 4: Legacy - Find all .prose elements
    const allProse = document.querySelectorAll('.prose');
    const proseArray = Array.from(allProse);
    const thisProseIndex = proseArray.findIndex(el =>
      assistantElement.contains(el) || el.contains(assistantElement) || el === assistantElement
    );
    if (thisProseIndex > 0) {
      const prevText = proseArray[thisProseIndex - 1].textContent?.trim();
      if (prevText && prevText.length < 5000) return prevText;
    }

    return '(User prompt not found)';
  }

  /**
   * Check if an element is still streaming
   */
  function isStreaming(element) {
    if (element.getAttribute('data-is-streaming') === 'true') return true;
    const streamingParent = element.closest('[data-is-streaming="true"]');
    if (streamingParent) return true;
    // Check for streaming indicators in the subtree
    if (element.querySelector('[data-is-streaming="true"]')) return true;
    if (element.querySelector('.streaming')) return true;
    if (element.querySelector('[data-streaming="true"]')) return true;
    return false;
  }

  /**
   * Process a single response element
   */
  function processResponse(responseElement) {
    if (responseElement.hasAttribute(PROCESSED_ATTR)) return;

    // Don't process if still streaming
    if (isStreaming(responseElement)) return;

    // Mark as processed early to prevent re-processing
    responseElement.setAttribute(PROCESSED_ATTR, 'true');

    // Get the response text - try new selectors first
    const contentEl = responseElement.querySelector('.font-claude-response-body') ||
                      responseElement.querySelector('.standard-markdown') ||
                      responseElement.querySelector('.prose') ||
                      responseElement;
    const aiResponse = contentEl.textContent?.trim();
    if (!aiResponse || aiResponse.length < 10) return;

    const userPrompt = getUserPrompt(responseElement);

    // Insert the rate button at the response element
    humaneOverlay.injectRateButton(responseElement, userPrompt, aiResponse, MODEL_NAME);
  }

  /**
   * Scan for Claude's assistant responses
   */
  function scanForResponses() {
    const seen = new Set();

    // Primary: find all .standard-markdown elements (new Claude structure)
    const standardMarkdown = document.querySelectorAll('.standard-markdown');
    standardMarkdown.forEach(el => {
      if (seen.has(el) || el.hasAttribute(PROCESSED_ATTR)) return;
      if (el.closest('[contenteditable]') || el.closest('textarea')) return;

      seen.add(el);
      if (isAssistantMessage(el)) {
        processResponse(el);
      }
    });

    // Secondary: find elements with row-start-2 that contain responses
    const gridResponses = document.querySelectorAll('[class*="row-start-2"]');
    gridResponses.forEach(el => {
      if (seen.has(el) || el.hasAttribute(PROCESSED_ATTR)) return;
      if (el.closest('[contenteditable]') || el.closest('textarea')) return;

      // Check if contains response content
      const hasContent = el.querySelector('.standard-markdown') ||
                        el.querySelector('.font-claude-response-body');
      if (hasContent && !hasContent.hasAttribute(PROCESSED_ATTR)) {
        seen.add(hasContent);
        processResponse(hasContent);
      }
    });

    // Legacy: find all chat-message-content elements
    const legacyMessages = document.querySelectorAll('[data-testid="chat-message-content"]');
    legacyMessages.forEach(el => {
      if (seen.has(el) || el.hasAttribute(PROCESSED_ATTR)) return;
      if (el.closest('[contenteditable]') || el.closest('textarea')) return;

      seen.add(el);
      if (isAssistantMessage(el)) {
        processResponse(el);
      }
    });

    // Legacy fallback: .prose elements
    const proseElements = document.querySelectorAll('.prose');
    proseElements.forEach(el => {
      if (seen.has(el) || el.hasAttribute(PROCESSED_ATTR)) return;
      if (el.closest('[contenteditable]') || el.closest('textarea')) return;

      const text = el.textContent?.trim();
      if (!text || text.length < 10) return;

      seen.add(el);
      if (isAssistantMessage(el)) {
        processResponse(el);
      }
    });
  }

  /**
   * Observe DOM for new responses
   */
  function observeNewResponses() {
    let scanTimeout = null;

    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
        if (mutation.type === 'attributes' &&
            (mutation.attributeName === 'data-is-streaming' || mutation.attributeName === 'data-streaming')) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(scanForResponses, 1500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-is-streaming', 'data-streaming']
    });
  }

  function init() {
    console.log('[Humane AI Rater] Claude content script loaded');
    scanForResponses();
    observeNewResponses();
    // Re-scan periodically in case DOM mutations are missed
    setInterval(scanForResponses, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 2000);
  }
})();
