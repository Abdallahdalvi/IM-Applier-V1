# 🤖 DALVI - Internshala Auto Job Applier

## 📋 Project Overview
**Dalvi** is an intelligent automation tool that automatically applies to jobs on **Internshala** (popular Indian internship/job platform) using:
- AI-powered form filling
- Resume parsing and matching
- Smart question classification
- Playwright browser automation
- Electron desktop app wrapper

---

## 🏗️ Architecture & How It Works

### **Phase 1: Job Discovery** (`dalvi-internshala-discovery.js`)
```
┌─────────────────────────────────────────────┐
│ 1. Connect to Electron Browser (Playwright) │
│    (via remote debugging port 9222)         │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ 2. Navigate to Internshala Job Categories   │
│    - Sales Jobs                              │
│    - Customer Service Jobs                   │
│    - BPO/Call Center Jobs                   │
│    (4 predefined profiles)                  │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ 3. Scrape Job Cards (divs with class:      │
│    "internship_meta")                       │
│    - Extract: Title, Company, Location      │
│    - Filter by keywords                     │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ 4. Save to job-queue.json (100-500 jobs)   │
│    Each job has:                            │
│    - id (base64 hash)                       │
│    - title, company, location               │
│    - jobLink, platform, profile             │
│    - discoveredAt timestamp                 │
└─────────────────────────────────────────────┘
```

### **Phase 2: Job Filtering** (`job-engine/job-filter.js`)
```
job-queue.json (500 jobs)
       ↓
Filter by ALLOWED keywords:
- "social", "digital", "marketing", 
- "content", "growth", "community"
       ↓
REMOVE jobs with BLOCK keywords:
- "sales", "business development", 
- "telecaller", "customer support"
       ↓
job-queue-filtered.json (50-100 jobs)
```

### **Phase 3: Intelligent Auto-Apply** (`job-engine/internshala-auto-apply.js`)

```
┌─────────────────────────────────────────────┐
│ For each job in filtered queue:             │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Step 1: Check if already applied (on disk)  │
│         Skip if in applied-jobs.json        │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Step 2: Load job page                       │
│         - Wait for DOM content              │
│         - Validate URL is internshala.com   │
│         - Check for "already applied" text  │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Step 3: Click "Apply" Button                │
│         - Scroll to bottom                  │
│         - Find apply button                 │
│         - Click with delay                  │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Step 4: Fill Application Form Smartly       │
│         Use: Question Classifier + AI        │
│                                              │
│         a) Classify question type:           │
│            - salary, experience, location    │
│            - yes/no, notice_period          │
│            - explanation                    │
│                                              │
│         b) Get answer from:                  │
│            Rule Engine (80% cases)           │
│            OR                                │
│            GPT-4 Mini (for explanations)     │
│                                              │
│         c) Fill all form fields:             │
│            - Textareas (questions)           │
│            - Contenteditable divs            │
│            - Text inputs                     │
│            - Radio buttons (auto-select)    │
│            - Dropdowns (auto-select)        │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Step 5: Validate Form                       │
│         - Check for blocking required fields│
│         - Ensure all visible fields filled  │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Step 6: Submit Application                  │
│         - Click Submit button               │
│         - Wait for confirmation             │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Step 7: Verify Success                      │
│         - Check for success message         │
│         - Check URL redirect (/applications)│
│         - Save to applied-jobs.json         │
└─────────────────────────────────────────────┘
```

---

## 🧠 AI/Form Filling Intelligence

### **Question Classification** (`ai/question-classifier.js`)
Maps questions to types:
```javascript
"What's your expected salary?" → "salary"
"Notice period?" → "notice_period"
"How many days to join?" → "joining_days"
"Your experience?" → "experience"
"Where do you stay?" → "location"
"Are you available?" → "availability"
"Rate your skills" → "rating"
"Why should we hire you?" → "explanation"
```

### **Answer Generation** (`ai/answer-engine.js`)
```
For each question:
1. Classify question type
2. Try Rule Engine first (profile.json)
   - 80% of questions answered
   - Structured rules for common Q&A
3. If "explanation" type:
   - Send to GPT-4 Mini
   - Provide context: job title, company, resume
   - Get personalized answer
4. Return answer or "NOT_SURE"
```

### **Rule Engine** (`ai/rule-engine.js`)
```javascript
// Profile data stored in ai/profile.json
{
  "availability": "Immediate",
  "location": "Mumbai",
  "noticePeriodDays": 0,
  "experienceYears": {
    "sales": 2,
    "customer_support": 3,
    "digital_marketing": 1
  },
  "expectedSalary": {
    "monthly": 25000,
    "yearly": 300000
  }
}
```

---

## 📁 File Structure & Responsibilities

```
dalvi/
├── src/
│   ├── main.js                    # Electron app entry point
│   ├── renderer.js                # UI renderer
│   ├── index.html                 # HTML template
│   └── index.css                  # Styling
│
├── job-engine/                    # Core job automation
│   ├── internshala-auto-apply.js  # Main applier script ⭐
│   ├── job-filter.js              # Filter jobs by keywords
│   ├── run-internshala.js         # Runner script
│   ├── profile-config.js          # Profile categories
│   ├── applied-jobs.json          # Cache: applied job IDs
│   └── skip-reasons.json          # Cache: skip stats
│
├── ai/                            # AI & form filling
│   ├── question-classifier.js     # Classify question type
│   ├── answer-engine.js           # Get answers (rule/AI)
│   ├── rule-engine.js             # Rule-based answers
│   ├── profile.json               # User profile data
│   └── profile.json               # Test profile
│
├── resume-engine/                 # Resume parsing & optimization
│   ├── resume-parser.js           # Parse PDF resume
│   ├── resume-structurer.js       # Structure resume data
│   ├── resume-optimizer.js        # Match resume to JD
│   ├── match-scorer.js            # Score resume-JD match
│   ├── resume-to-pdf.js           # Generate optimized PDF
│   ├── base/
│   │   └── user-resume.pdf        # Original resume
│   ├── output/
│   │   └── optimized-*.pdf        # Generated PDFs
│   └── pdf/
│       └── *.pdf                  # Temp PDFs
│
├── dalvi-internshala-discovery.js # Job discovery script ⭐
├── ai-helper.js                   # OpenAI API helper
├── package.json                   # Dependencies
├── resume.txt                      # Parsed resume as text
├── job-queue.json                 # Discovered jobs
├── job-queue-filtered.json        # Filtered jobs
└── applied-jobs.json              # Applied job tracking
```

---

## 🔄 Complete Workflow

```
┌─────────────────────────────────────────────────────────┐
│ 1. RUN DISCOVERY                                        │
│    npm run discovery (or node dalvi-internshala-discovery.js)
│    Output: job-queue.json (500+ jobs)                   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. FILTER JOBS                                          │
│    node job-engine/job-filter.js                        │
│    Input: job-queue.json                                │
│    Output: job-queue-filtered.json (50-100 jobs)       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. AUTO-APPLY                                           │
│    npm start (launch Electron)                          │
│    Then: node job-engine/internshala-auto-apply.js      │
│    Applies to jobs automatically                        │
│    Output: applied-jobs.json (tracks applied jobs)      │
└─────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Browser Automation | Playwright | Control Electron browser instance |
| Form Filling | Playwright Locators | Find & fill form elements |
| AI/LLM | OpenAI GPT-4 Mini | Generate contextual answers |
| Desktop App | Electron + Webpack | Desktop wrapper with remote debugging |
| PDF Processing | pdf-parse, pdfkit | Resume parsing & optimization |
| Data Storage | JSON files | Cache jobs, applied logs, etc |
| Environment | dotenv | Store OpenAI API key securely |

---

## 🎯 Key Features

✅ **Smart Job Discovery** - Scrapes Internshala for relevant jobs  
✅ **Intelligent Filtering** - Includes/excludes by keywords  
✅ **Automated Form Filling** - Fills textareas, inputs, dropdowns, radios  
✅ **AI-Powered Answers** - Uses GPT-4 for explanation questions  
✅ **Rule-Based Fast Track** - Answers 80% questions without AI  
✅ **Duplicate Prevention** - Tracks applied jobs in JSON  
✅ **Resume Integration** - Includes resume context in answers  
✅ **Error Handling** - Skips problematic applications  
✅ **Statistics** - Tracks applied/skipped/errors  
✅ **Configurable Profiles** - Different job categories/rules  

---

## 📊 Statistics & Metrics

The applier tracks:
- `applied` - Successfully applied count
- `skipped_disk` - Already in database
- `skipped_ui` - Already applied (detected on page)
- `skipped_redirect` - URL mismatch
- `skipped_text` - Blocking text detected
- `skipped_no_cta` - No apply button found
- `skipped_external` - External form/redirect
- `errors` - Script errors

---

## 🔧 Configuration

### Profile Configuration (`ai/profile.json`)
```json
{
  "availability": "Immediate",
  "location": "Mumbai",
  "noticePeriodDays": 0,
  "experienceYears": {
    "sales": 2,
    "customer_support": 3,
    "digital_marketing": 1
  },
  "expectedSalary": {
    "monthly": 25000,
    "yearly": 300000
  }
}
```

### Job Categories (`job-engine/profile-config.js`)
- Social Media Marketing
- Digital Marketing
- Content & Branding
- Marketing & Growth

### Internshala Discovery (`dalvi-internshala-discovery.js`)
- Sales, Customer Service, Support, BPO categories
- Scans specific Internshala URLs
- Filters by keywords

---

## ⚙️ Dependencies

```json
{
  "playwright": "^1.57.0",      // Browser automation
  "openai": "^6.10.0",          // AI API
  "electron": "39.2.7",         // Desktop app
  "pdf-parse": "^1.1.1",        // Resume parsing
  "pdfkit": "^0.17.2",          // PDF generation
  "dotenv": "^17.2.3"           // Environment vars
}
```

---

## 🚀 How to Use It

### Setup
```bash
npm install
```

### Environment
```bash
# Create .env file
OPENAI_API_KEY=sk-xxxxx
```

### 🚨 Ubuntu/Environment Note (Moonlight/Sunshine)
If you encounter a `FATAL:setuid_sandbox_host.cc` error on Ubuntu, the sandbox must be disabled. The `npm start` command has been updated to handle this automatically:
```bash
# In package.json:
"start": "ELECTRON_DISABLE_SANDBOX=1 electron-forge start"
```

### Run
```bash
# 1. Start Electron (keeps browser window open)
npm start

# 2. In another terminal, discover jobs
node dalvi-internshala-discovery.js

# 3. Filter jobs
node job-engine/job-filter.js

# 4. Auto-apply (runs against Electron browser instance)
node job-engine/internshala-auto-apply.js
```

---

## 🎓 What This Teaches For IndiaMART Project

This project demonstrates:

1. **Browser Automation Pattern**
   - Playwright for page navigation & interaction
   - Waiting for DOM elements
   - Form field detection & filling
   - Scroll behavior

2. **Data Pipeline**
   - Discovery → Filtering → Action
   - JSON-based data persistence
   - Deduplication & tracking

3. **AI Integration**
   - Question classification logic
   - Rule-based answers (fast path)
   - LLM fallback for complex cases
   - Context injection (resume, job details)

4. **Error Handling**
   - UI state detection
   - Validation before action
   - Statistics & logging

5. **Configuration Management**
   - Profile-based settings
   - Environment variables
   - Keyword filtering

---

## 🚨 Known Issues & Limitations

1. **Depends on Electron Running** - Browser instance must be active
2. **Internshala May Change DOM** - Selectors may break
3. **Rate Limiting** - Internshala might block rapid requests
4. **API Costs** - OpenAI GPT-4 calls add up
5. **No Resume Upload** - Form assumes resume auto-attached
6. **Hardcoded Profile** - Not multi-user ready
7. **No Captcha Handling** - Fails on captchas

---

## 🎯 Adaptation for IndiaMART

### Changes Needed:
1. Replace Internshala discovery with IndiaMART product scraping
2. Different form structure (product listing vs job application)
3. Different AI prompts (product features, pricing vs job answers)
4. Bulk image upload handling
5. Inventory management integration
6. Different validation rules

### What Stays Same:
- Playwright browser automation
- AI-powered content generation
- Rule-based fast path
- Filtering & deduplication
- Statistics & tracking

---

## 📝 Summary

**Dalvi** is a sophisticated **job application automation tool** that combines:
- **Web scraping** (discover jobs)
- **Intelligent filtering** (relevant jobs only)
- **Form automation** (fill applications)
- **AI integration** (generate answers)
- **Tracking** (avoid duplicates)

It demonstrates a complete end-to-end automation pipeline suitable for adaptation to IndiaMART bulk product listing.

