# Humane AI Rater

A Chrome browser extension that empowers users to rate AI chatbot interactions against HumaneBench's 8 Humane Technology Principles, creating crowdsourced humaneness data to drive accountability in AI development.

## Overview

AI chatbots influence hundreds of millions of people daily, yet users have no visibility into whether these systems are designed for their wellbeing. Research shows 67-71% of AI models exhibit potentially harmful behavior under adversarial prompts—invisible to consumers.

Humane AI Rater addresses this by providing a one-tap rating system that:
- Evaluates AI responses across 8 humaneness principles
- Creates crowdsourced data for consumer empowerment
- Generates public leaderboards to pressure AI companies to compete on being humane

## Features

- **One-Tap Rating**: Rate any AI response with a single click
- **8-Principle Evaluation**: Powered by HumaneBench methodology using Google Gemini API
- **Multi-Platform Support**: Works on ChatGPT, Claude, Grok, and Deepseek
- **Local + Global Leaderboards**: Track personal scores locally and contribute to global rankings
- **Firebase Backend**: Anonymous ratings synced to cloud for aggregated insights
- **Real-Time Detection**: Automatically detects AI responses using MutationObserver

### The 8 HumaneBench Principles

| Principle | Description |
|-----------|-------------|
| Respect User Attention | Concise responses without unnecessary filler |
| Enable Meaningful Choices | Provides alternatives and empowers users |
| Enhance Human Capabilities | Teaches and builds understanding |
| Protect Dignity & Safety | Proactive safety awareness |
| Foster Healthy Relationships | Maintains AI boundaries, avoids parasocial language |
| Prioritize Long-term Wellbeing | Addresses root causes, not shortcuts |
| Be Transparent & Honest | Acknowledges uncertainty, avoids hallucinations |
| Design for Equity & Inclusion | Avoids bias and exclusionary language |

## Installation

### Prerequisites

- Google Chrome browser (version 88 or later)
- Free Google Gemini API key

### Step 1: Install the Extension

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/humane-ai-rater.git
   cd humane-ai-rater
   ```

2. Open Chrome and navigate to:
   ```
   chrome://extensions/
   ```

3. Enable **Developer mode** (toggle in top-right corner)

4. Click **Load unpacked** and select the `humane-ai-rater` directory

### Step 2: Get a Gemini API Key (Free)

1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API Key**
4. Copy the generated key

### Step 3: Configure the Extension

1. Click the Humane AI Rater extension icon in Chrome
2. Navigate to the **Settings** tab
3. Paste your Gemini API key
4. Click **Save**

### Step 4: Start Rating

1. Visit any supported AI platform (ChatGPT, Claude, Grok, or Deepseek)
2. Have a conversation with the AI
3. Click the **Rate Humaneness** button next to any AI response
4. View the detailed score breakdown

## Usage

### Rating an AI Response

1. Navigate to a supported AI chatbot
2. Send a message and wait for the AI response
3. A "Rate Humaneness" button appears near each response
4. Click to evaluate—the extension sends the prompt/response to Gemini for analysis
5. View color-coded scores across all 8 principles
6. Optionally save a thumbs up/down vote

### Viewing the Leaderboard

1. Click the extension icon
2. The **Leaderboard** tab shows ranked AI platforms by average humaneness score
3. The **Recent** tab displays your last 10 ratings with full breakdowns

### Managing Settings

- **API Key**: Update or change your Gemini API key
- **Clear Data**: Remove all local ratings and reset the leaderboard
- **About**: Learn more about HumaneBench methodology

## Supported Platforms

| Platform | URL Patterns |
|----------|--------------|
| ChatGPT | `chatgpt.com/*`, `chat.openai.com/*` |
| Claude | `claude.ai/*` |
| Grok | `grok.com/*`, `x.com/*`, `twitter.com/*` |
| Deepseek | `chat.deepseek.com/*` |

## Project Structure

```
humane-ai-rater/
├── manifest.json              # Chrome extension configuration (Manifest V3)
├── popup/                     # Extension popup UI
│   ├── popup.html            # Popup interface
│   ├── popup.js              # Popup logic & data management
│   └── popup.css             # Popup styling
├── content/                   # Content scripts for each platform
│   ├── overlay.js            # Shared rating overlay UI
│   ├── chatgpt.js            # ChatGPT integration
│   ├── claude.js             # Claude integration
│   ├── grok.js               # Grok integration
│   └── deepseek.js           # Deepseek integration
├── shared/                    # Shared utilities
│   ├── humanebench.js        # HumaneBench evaluation logic
│   └── storage.js            # Chrome storage management
├── styles/
│   └── overlay.css           # Overlay styling
├── background/
│   └── service-worker.js     # Gemini API + Firebase sync
├── firebase/                  # Backend infrastructure
│   ├── firebase.json         # Firebase configuration
│   ├── firestore.rules       # Security rules
│   └── functions/            # Cloud Functions
│       ├── index.js          # Validation, aggregation functions
│       └── package.json      # Dependencies
└── icons/                     # Extension icons (16x48x128px)
```

## Technology Stack

| Component | Technology |
|-----------|------------|
| Extension Framework | Chrome Manifest V3 |
| Frontend | Vanilla JavaScript (ES6+) |
| LLM Evaluation | Google Gemini 2.0 Flash API |
| Local Storage | Chrome Storage API |
| Backend | Firebase Cloud Functions |
| Database | Firebase Firestore |

## Backend (Firebase)

The extension syncs ratings to Firebase for global aggregates. The backend is already deployed at:

- **Submit Rating**: `https://us-central1-humane-ai-rater.cloudfunctions.net/submitAnonymousRating`
- **Get Aggregates**: `https://us-central1-humane-ai-rater.cloudfunctions.net/getAggregates`

### For Development/Self-Hosting:

### Setup Firebase

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Authenticate
firebase login

# Navigate to firebase directory
cd firebase

# Initialize project
firebase init

# Install function dependencies
cd functions && npm install

# Deploy
firebase deploy --only functions
```

### Local Development

```bash
cd firebase

# Start emulators
firebase emulators:start --only functions

# View logs
firebase functions:log
```

### Cloud Functions

| Function | Purpose |
|----------|---------|
| `submitAnonymousRating` | HTTP endpoint for extension to submit ratings |
| `validateRating` | Firestore trigger for anti-spoofing & rate limiting |
| `getAggregates` | Public leaderboard data endpoint |
| `computeWeeklyTrends` | Daily scheduled trend computation |
| `cleanupRateLimits` | Weekly cleanup of old rate limit records |

## Configuration

### Extension Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access active tab for content injection |
| `storage` | Store ratings, API key, leaderboard data |
| `host_permissions` | Access Google Generative Language API |

### Environment Variables

The extension requires no environment variables. Users provide their own Gemini API key through the Settings UI.

## Data Flow

```
User views AI response
       ↓
Content script injects "Rate Humaneness" button
       ↓
User clicks button
       ↓
Service worker sends prompt + response to Gemini API
       ↓
Gemini evaluates across 8 principles (scores -1.0 to 1.0)
       ↓
Overlay displays color-coded score panel
       ↓
User saves optional thumbs up/down
       ↓
Rating stored locally + synced to Firebase
       ↓
Global aggregates updated for public leaderboard
```

## Privacy & Security

- **Anonymous by design**: Device hash used for rate-limiting, no personal identifiers
- **Minimal data synced to Firebase**:
  - Platform name (ChatGPT, Claude, etc.)
  - Overall score and rating (positive/negative)
  - Prompt preview (first 100 characters only)
  - Behavioral signals (viewport time, interaction flags)
- **Data NOT sent to Firebase**:
  - Full conversation text
  - Complete AI responses
  - Personal information or account details
- **Local storage**: Full ratings stored on device for personal leaderboard
- **User-controlled API key**: Each user provides their own Gemini key
- **Anti-spoofing**: Rate limiting (50 ratings/day) and behavioral validation
- **Transparent methodology**: Links to HumaneBench.ai for full rubric

## Troubleshooting

### "Rate Humaneness" button not appearing

- Ensure the extension is enabled in `chrome://extensions/`
- Refresh the page
- Check that you're on a supported platform

### Evaluation fails or times out

- Verify your Gemini API key is valid in Settings
- Check your API quota at Google AI Studio
- Ensure you have internet connectivity

### Scores not showing in popup

- Make sure you've completed at least one rating
- Try clearing data in Settings and re-rating

## Known Limitations

- DOM selectors may break when platforms update their UI
- Gemini free tier has rate limits for high-volume usage
- Currently Chrome-only (Firefox/Safari planned for future)
- Full conversation not stored—only individual prompt/response pairs

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Roadmap

- [ ] Firefox and Safari extensions
- [ ] Mobile apps (iOS/Android)
- [ ] Public web dashboard with global leaderboards
- [ ] Shareable score cards
- [ ] User accounts for authenticated ratings
- [ ] Expanded platform support (Copilot, Gemini, Perplexity)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [HumaneBench](https://humanebench.ai) for the 8 Humane Technology Principles
- [Building Humane Tech](https://buildinghumanetech.com) for the hackathon opportunity
- Google for the Gemini API free tier

---

**Built with care for a more humane AI future.**
