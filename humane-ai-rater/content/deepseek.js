/**
 * Content Script for Deepseek (chat.deepseek.com)
 * Detects AI responses and injects HumaneBench rating buttons.
 *
 * Deepseek is a Chinese AI model that adds global/emerging model diversity
 * to the HumaneBench evaluation landscape.
 */

(function () {
  const MODEL_NAME = 'Deepseek';
  const PROCESSED_ATTR = 'data-humane-processed';

  /**
   * Platform-specific configuration for Deepseek
   * Based on actual Deepseek DOM structure (Feb 2025)
   */
  const DEEPSEEK_CONFIG = {
    // Response selectors - Deepseek uses .ds-message and .ds-markdown
    responseSelectors: [
      '.ds-message',                    // Main message container
      '.ds-markdown'                    // Markdown content
    ],

    // Content selectors within a response
    contentSelectors: [
      '.ds-markdown',
      '.ds-markdown-paragraph'
    ],

    // User message selectors (need to identify from DOM - likely different class)
    userSelectors: [
      '.ds-message-user',               // Guessed pattern
      '[class*="user"]'
    ],

    // Streaming indicators
    streamingSelectors: [
      '[data-streaming="true"]',
      '.streaming',
      '[class*="streaming"]',
      '[class*="loading"]'
    ]
  };

  /**
   * Check if an element is a Deepseek assistant response
   */
  function isAssistantResponse(element) {
    // Check for .ds-message class (main message container)
    if (element.classList.contains('ds-message')) {
      // Check it's not a user message (user messages may have different structure)
      const className = element.className || '';
      if (className.includes('user')) return false;
      return true;
    }

    // Check for .ds-markdown (assistant responses have markdown)
    if (element.classList.contains('ds-markdown')) {
      return true;
    }

    // Check parent for ds-message
    const parent = element.closest('.ds-message');
    if (parent) {
      const parentClass = parent.className || '';
      if (!parentClass.includes('user')) return true;
    }

    return false;
  }

  /**
   * Check if response is still streaming
   */
  function isStreaming(element) {
    // Direct streaming attributes
    if (element.getAttribute('data-streaming') === 'true' ||
        element.getAttribute('data-is-streaming') === 'true') {
      return true;
    }

    // Check for streaming class
    const className = (element.className || '').toLowerCase();
    if (className.includes('streaming') || className.includes('typing')) {
      return true;
    }

    // Check for streaming indicators within element
    for (const sel of DEEPSEEK_CONFIG.streamingSelectors) {
      try {
        if (element.querySelector(sel)) return true;
      } catch (e) { /* invalid selector */ }
    }

    // Check ancestor streaming state
    const streamingParent = element.closest('[data-streaming="true"], [data-is-streaming="true"]');
    if (streamingParent) return true;

    // Check for cursor/caret animation (common streaming indicator)
    const cursor = element.querySelector('[class*="cursor"], [class*="caret"]');
    if (cursor && window.getComputedStyle(cursor).animationName !== 'none') {
      return true;
    }

    return false;
  }

  /**
   * Extract the user prompt that precedes an assistant response.
   */
  function getUserPrompt(assistantElement) {
    // Strategy 1: Find the .ds-message container and walk backward
    const messageContainer = assistantElement.closest('.ds-message') || assistantElement;

    let current = messageContainer;
    while (current) {
      let prev = current.previousElementSibling;
      while (prev) {
        // Check if this is a user message (doesn't have .ds-markdown typically)
        // Or has user-related classes
        const hasMarkdown = prev.querySelector('.ds-markdown');
        const className = (prev.className || '').toLowerCase();

        // User messages likely don't have the .ds-markdown structure
        // or have specific user class indicators
        if (!hasMarkdown || className.includes('user')) {
          const text = prev.innerText.trim();
          if (text && text.length > 0 && text.length < 5000) {
            return text;
          }
        }
        prev = prev.previousElementSibling;
      }
      current = current.parentElement;
      if (current === document.body) break;
    }

    // Strategy 2: Get all .ds-message elements and find the one before
    const allMessages = document.querySelectorAll('.ds-message');
    const msgArray = Array.from(allMessages);
    const currentIndex = msgArray.indexOf(messageContainer);

    if (currentIndex > 0) {
      const prevMsg = msgArray[currentIndex - 1];
      const text = prevMsg.innerText.trim();
      if (text && text.length > 0 && text.length < 5000) {
        return text;
      }
    }

    // Strategy 3: Look for any text input or user content area
    const userInputs = document.querySelectorAll('[class*="user"], [class*="input"], [class*="prompt"]');
    for (const input of userInputs) {
      if (!input.querySelector('.ds-markdown')) {
        const text = input.innerText.trim();
        if (text && text.length > 0 && text.length < 2000) {
          return text;
        }
      }
    }

    return '(User prompt not found)';
  }

  /**
   * Get the text content of an assistant response
   */
  function getResponseText(element) {
    // Look for .ds-markdown content first
    const dsMarkdown = element.querySelector('.ds-markdown');
    if (dsMarkdown) {
      return dsMarkdown.innerText.trim();
    }

    // Try .ds-markdown-paragraph
    const paragraph = element.querySelector('.ds-markdown-paragraph');
    if (paragraph) {
      return paragraph.innerText.trim();
    }

    // If element itself is .ds-markdown
    if (element.classList.contains('ds-markdown')) {
      return element.innerText.trim();
    }

    return element.innerText.trim();
  }

  /**
   * Process a single assistant response element
   */
  function processResponse(responseElement) {
    if (responseElement.hasAttribute(PROCESSED_ATTR)) return;

    // Skip if still streaming
    if (isStreaming(responseElement)) return;

    responseElement.setAttribute(PROCESSED_ATTR, 'true');

    const aiResponse = getResponseText(responseElement);
    if (!aiResponse || aiResponse.length < 10) return;

    const userPrompt = getUserPrompt(responseElement);

    // Inject at the end of .ds-message container (after the markdown content)
    // This ensures the button appears at the bottom of the full response
    const messageContainer = responseElement.closest('.ds-message') || responseElement;
    humaneOverlay.injectRateButton(messageContainer, userPrompt, aiResponse, MODEL_NAME);
  }

  /**
   * Scan the page for unprocessed assistant responses
   */
  function scanForResponses() {
    const seen = new Set();

    // Primary: find all .ds-message elements that contain .ds-markdown (assistant responses)
    const allMessages = document.querySelectorAll('.ds-message');
    allMessages.forEach(el => {
      if (seen.has(el) || el.hasAttribute(PROCESSED_ATTR)) return;

      // Only process messages that have .ds-markdown (assistant responses)
      const hasMarkdown = el.querySelector('.ds-markdown');
      if (hasMarkdown) {
        seen.add(el);
        processResponse(el);
      }
    });

    // Fallback: find orphan .ds-markdown elements
    const markdownElements = document.querySelectorAll('.ds-markdown');
    markdownElements.forEach(el => {
      const parent = el.closest('.ds-message');
      if (parent) {
        if (!seen.has(parent) && !parent.hasAttribute(PROCESSED_ATTR)) {
          seen.add(parent);
          processResponse(parent);
        }
      } else if (!seen.has(el) && !el.hasAttribute(PROCESSED_ATTR)) {
        seen.add(el);
        processResponse(el);
      }
    });
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
        scanTimeout = setTimeout(scanForResponses, 1200);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initial scan + observer
  function init() {
    console.log('[Humane AI Rater] Deepseek content script loaded');
    scanForResponses();
    observeNewResponses();

    // Re-scan periodically in case mutations are missed
    setInterval(scanForResponses, 5000);
  }

  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Give the SPA time to render
    setTimeout(init, 2000);
  }
})();
