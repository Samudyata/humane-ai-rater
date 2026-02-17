# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Humane AI Rater is a Chrome extension (Manifest V3) that lets users rate AI chatbot responses against HumaneBench's 8 Humane Technology Principles. It uses Google Gemini 2.0 Flash as an LLM judge to evaluate conversations, then displays color-coded scores inline on the chatbot page. An optional Firebase backend provides cloud aggregation, authentication, and anti-spoofing.

## Repository Structure

The Chrome extension source lives in `humane-ai-rater/` (not the repo root). The repo root contains `firebase.json`, `README.md`, and the `.git` directory.

- `humane-ai-rater/manifest.json` - Extension manifest (Manifest V3)
- `humane-ai-rater/content/` - Per-platform content scripts (chatgpt.js, claude.js, grok.js, deepseek.js)
- `humane-ai-rater/shared/` - Shared modules injected into all content scripts
- `humane-ai-rater/background/service-worker.js` - Background service worker (Gemini API calls)
- `humane-ai-rater/popup/` - Extension popup UI (leaderboard, recent ratings, settings)
- `humane-ai-rater/styles/overlay.css` - Overlay styling injected into host pages
- `humane-ai-rater/firebase/functions/` - Firebase Cloud Functions backend

## Architecture

### Content Script Injection Chain

Each supported platform gets a content script bundle defined in `manifest.json`. The injection order matters — shared modules must load before platform scripts:

1. `shared/humanebench.js` - Principle definitions, score helpers (`getScoreColor`, `getScoreLabel`, `getScoreClass`), prompt formatting, response parsing, validation
2. `shared/storage.js` - Chrome Storage API wrappers for ratings, leaderboard, API key
3. `content/overlay.js` - `HumaneOverlay` class (creates `humaneOverlay` global instance) that renders rate buttons and score panels
4. `content/<platform>.js` - Platform-specific DOM detection via MutationObserver + periodic scanning

### Evaluation Flow

1. Content script detects AI responses using platform-specific DOM selectors and MutationObserver
2. `humaneOverlay.injectRateButton()` adds a "Rate Humaneness" button to each response
3. On click, sends `{type: 'evaluate'}` message to background service worker
4. Service worker calls Gemini API with the HumaneBench rubric prompt, parses JSON response
5. Scores are validated (must be exactly 8 principles, scores in {-1.0, -0.5, 0.5, 1.0})
6. Results stored in Chrome local storage; overlay renders the score panel

### Duplicate Logic Warning

The service worker (`background/service-worker.js`) contains **inline copies** of functions from `shared/humanebench.js` and `shared/storage.js` (suffixed with `Bg`). This is because service workers can't import content scripts. When modifying evaluation logic, prompt text, or storage format, update **both** locations.

### Platform Content Scripts Pattern

All four platform scripts (chatgpt.js, claude.js, grok.js, deepseek.js) follow the same pattern:
- IIFE wrapper with `MODEL_NAME` and `PROCESSED_ATTR` constants
- `getUserPrompt()` - walks DOM backward to find the preceding user message
- `processResponse()` - extracts text, calls `humaneOverlay.injectRateButton()`
- `scanForResponses()` - queries platform-specific selectors
- `observeNewResponses()` - MutationObserver with debounced scanning
- `init()` - initial scan + observer + `setInterval` fallback (5s)

Platform DOM selectors are fragile and may break when platforms update their UI.

## Commands

### Firebase Functions

```bash
cd humane-ai-rater/firebase/functions && npm install    # Install dependencies
cd humane-ai-rater/firebase && firebase emulators:start --only functions  # Local dev
cd humane-ai-rater/firebase/functions && npx eslint .   # Lint
firebase deploy --only functions                         # Deploy to production
```

### Loading the Extension

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked" and select the `humane-ai-rater/` directory

There is no build step — the extension uses vanilla JS (ES6+) directly.

## Key Technical Details

- **Scores** use a 4-point scale: 1.0 (Exemplary), 0.5 (Acceptable), -0.5 (Concerning), -1.0 (Violation)
- **Gemini response parsing** strips markdown fences, finds JSON boundaries, and fixes `+0.5`/`+1.0` to valid JSON numbers
- **Storage** keeps the last 50 ratings in Chrome local storage
- **Leaderboard** maintains running averages per model (totalScore, count, avgScore)
- **Firebase functions** use Node 18 and firebase-functions v4 / firebase-admin v11
- **Authenticated endpoints** (createUserProfile, rate, submitReview, user, getUserRatings) verify Firebase Auth ID tokens via `Authorization: Bearer <token>` header
- **8 humaneness dimensions** are referenced by camelCase keys in Firebase (e.g., `respectUserAttention`) vs snake_case in the extension (e.g., `respect_attention`)
