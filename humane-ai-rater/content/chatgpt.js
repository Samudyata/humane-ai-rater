/**
 * Content Script for ChatGPT (chatgpt.com / chat.openai.com)
 * Detects AI responses and injects HumaneBench rating buttons.
 */

(function () {
  const MODEL_NAME = 'ChatGPT';
  const PROCESSED_ATTR = 'data-humane-processed';

  /**
   * Extract the user prompt that precedes an assistant response.
   * Walks backward through siblings/conversation to find the last user message.
   */
  function getUserPrompt(assistantElement) {
    // Try to find the conversation turn container
    const turnContainer = assistantElement.closest('[data-testid^="conversation-turn"]');
    if (turnContainer) {
      // Look for the previous turn with user role
      let prev = turnContainer.previousElementSibling;
      while (prev) {
        const userMsg = prev.querySelector('[data-message-author-role="user"]');
        if (userMsg) return userMsg.innerText.trim();
        prev = prev.previousElementSibling;
      }
    }

    // Fallback: look for all user messages and get the last one before this assistant message
    const allUserMsgs = document.querySelectorAll('[data-message-author-role="user"]');
    if (allUserMsgs.length > 0) {
      return allUserMsgs[allUserMsgs.length - 1].innerText.trim();
    }

    return '(User prompt not found)';
  }

  /**
   * Process a single assistant response element
   */
  function processResponse(responseElement) {
    if (responseElement.hasAttribute(PROCESSED_ATTR)) return;
    responseElement.setAttribute(PROCESSED_ATTR, 'true');

    const aiResponse = responseElement.innerText.trim();
    if (!aiResponse || aiResponse.length < 10) return;

    const userPrompt = getUserPrompt(responseElement);

    humaneOverlay.injectRateButton(responseElement, userPrompt, aiResponse, MODEL_NAME);
  }

  /**
   * Scan the page for unprocessed assistant responses
   */
  function scanForResponses() {
    // ChatGPT uses data-message-author-role="assistant" on response containers
    const responses = document.querySelectorAll('[data-message-author-role="assistant"]');
    responses.forEach(processResponse);

    // Also try the markdown prose class which wraps the actual text
    const proseResponses = document.querySelectorAll('.markdown.prose');
    proseResponses.forEach(el => {
      const parent = el.closest('[data-message-author-role="assistant"]');
      if (parent && !parent.hasAttribute(PROCESSED_ATTR)) {
        processResponse(parent);
      }
    });
  }

  /**
   * Set up a MutationObserver to detect new responses
   */
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
        // Debounce: wait for response to finish rendering
        setTimeout(scanForResponses, 1000);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initial scan + observer
  function init() {
    scanForResponses();
    observeNewResponses();

    // Re-scan periodically in case mutations are missed
    setInterval(scanForResponses, 5000);
  }

  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay to let ChatGPT's SPA render
    setTimeout(init, 2000);
  }
})();
