# AI Integration Plan for CRM

## Overview

This document outlines AI-powered features that can be added to the CRM platform. Features are grouped by domain and prioritized by impact.

---

## 1. Inbox & Conversations

### 1.1 AI Auto-Reply / Copilot

Agent gets AI-suggested replies based on conversation context, contact history, and deal stage.

- **Quick suggestions** — 2-3 short reply options appear above the message input
- **Full draft** — agent clicks "Draft with AI", gets a complete message they can edit before sending
- **Tone control** — formal / friendly / concise toggle
- **Context awareness** — AI reads last N messages, contact card, linked deal info, previous interactions across channels
- **Channel adaptation** — adjusts reply length and format for Telegram vs Email vs WhatsApp

### 1.2 Conversation Summary

Auto-generated summary of a conversation thread.

- Appears at the top of long conversations (10+ messages)
- Highlights: key requests, promises made, unresolved questions, sentiment
- Updated as new messages arrive
- Useful for agent handoff — new agent instantly understands context

### 1.3 Sentiment & Intent Detection

Real-time analysis of inbound messages.

- **Sentiment score** — positive / neutral / negative badge on each conversation
- **Intent classification** — purchase inquiry, support request, complaint, pricing question, scheduling, etc.
- **Urgency detection** — flags messages that need immediate attention
- **Escalation trigger** — automation rule: "if sentiment < threshold for 2+ messages → reassign to senior agent"

### 1.4 Auto-Translation

Real-time translation for multilingual conversations.

- Detect inbound message language automatically
- Show original + translated text to agent
- Agent writes in their language, AI translates outbound message to customer's language
- Per-conversation language override

### 1.5 Smart Routing

AI-based conversation assignment instead of simple round-robin.

- Route based on: topic, language, sentiment, customer value (deal size), agent expertise, agent current load
- Learn from past assignments — which agents resolve which topics faster
- VIP routing — high-value contacts go to best-performing agents

---

## 2. Contacts & Companies

### 2.1 Contact Enrichment

Auto-populate contact fields from external data.

- Given an email or phone, fill in: name, company, job title, social profiles, timezone
- Company enrichment: industry, size, revenue, tech stack, website info
- Periodic re-enrichment to keep data fresh
- Sources: Clearbit, Apollo, Hunter.io, or open web scraping

### 2.2 Duplicate Detection (AI-Enhanced)

Go beyond exact match — fuzzy matching with AI.

- Detect "John Smith" / "J. Smith" / "Иван Смит" as potential duplicates
- Compare phone numbers with different formats
- Suggest merge with confidence score
- Auto-merge option for high-confidence matches

### 2.3 Lead Scoring

AI-predicted score for each contact/lead.

- Inputs: source, engagement (messages sent/received), deal history, page visits, form fills, response time
- Output: 0-100 score + hot/warm/cold label
- Score updates in real-time as new events happen
- Sortable/filterable in contact list
- Automation trigger: "when lead score > 80 → create deal + notify manager"

### 2.4 Contact Insights Panel

AI-generated summary card on contact detail page.

- "Last contacted 5 days ago, has open deal worth $15K in Negotiation stage, responded positively to last 3 messages, prefers Telegram, most active on weekdays 10-14"
- Next best action suggestion: "Follow up on pricing proposal sent Feb 18"
- Relationship health indicator

---

## 3. Deals & Pipeline

### 3.1 Deal Win Probability

AI-predicted probability of closing a deal.

- Based on: stage, age, value, contact engagement, message sentiment, task completion rate, historical win/loss patterns
- Shown on deal card in Kanban and detail page
- Weighted pipeline view — total expected revenue = sum(deal value * probability)
- Alerts for deals with dropping probability

### 3.2 Deal Risk Alerts

Proactive identification of at-risk deals.

- "No activity in 7 days" — stale deal warning
- "Negative sentiment in last 2 conversations" — relationship risk
- "Past expected close date" — overdue deal
- "Contact hasn't responded in 5 days" — engagement drop
- Daily digest email/notification to deal owner

### 3.3 Revenue Forecasting

AI-powered revenue predictions.

- Monthly/quarterly forecast based on pipeline + historical close rates
- Best case / expected / worst case scenarios
- Trend analysis: "Pipeline is 20% lighter than last quarter at this point"
- Per-agent and per-pipeline forecasting

### 3.4 Next Best Action

AI suggests what the agent should do next on a deal.

- "Schedule a demo — similar deals that had demos closed 2x faster"
- "Send pricing — customer asked about costs in last message"
- "Escalate to manager — deal has been in Negotiation for 14 days (avg is 7)"
- Appears on deal detail page and in daily task digest

---

## 4. Tasks & Productivity

### 4.1 Smart Task Generation

AI auto-creates tasks based on conversations and deal stage.

- Customer says "call me tomorrow" → create call task for tomorrow
- Deal moves to "Proposal" stage → create task "Send proposal within 2 days"
- Customer hasn't responded in 3 days → create follow-up task
- Configurable per pipeline stage: default tasks for each stage

### 4.2 Daily Briefing

AI-generated morning summary for each agent.

- "You have 3 overdue tasks, 5 unread conversations, 2 deals need follow-up"
- Priority ranking of what to do first
- Delivered via Telegram notification, email, or in-app dashboard widget
- Includes overnight activity: new leads, messages received while offline

### 4.3 Meeting Prep

Auto-generated brief before scheduled calls/meetings.

- Contact background, deal history, last conversation summary
- Talking points based on deal stage and open questions
- Competitor mentions from past conversations
- Generated 30 min before meeting, sent as notification

---

## 5. Automation & Chatbots

### 5.1 AI Chatbot (Conversational)

Replace rigid chatbot flows with an LLM-powered conversational bot.

- Configure with: company knowledge base, FAQ, product catalog, pricing rules
- Bot handles first-line inquiries autonomously
- Smooth handoff to human agent when bot can't help or customer requests it
- Handoff includes AI summary of what was discussed
- Per-channel deployment: Telegram, WhatsApp, Web Chat, Instagram
- Configurable personality and boundaries ("never discuss competitor pricing")

### 5.2 Knowledge Base / RAG

Central knowledge repository that AI uses to answer questions.

- Upload documents: PDFs, docs, web pages, FAQ entries
- AI indexes and retrieves relevant info when answering
- Used by: AI chatbot, agent copilot (suggested replies), meeting prep
- Admin can add/edit/remove knowledge entries
- Source attribution — AI shows which document it used

### 5.3 Smart Automation Rules (Natural Language)

Create automation rules using natural language instead of form builder.

- "When a new contact is created from Telegram and they mention pricing, assign to sales team and create a deal"
- AI parses intent → generates trigger + conditions + actions
- Agent reviews and confirms before activating
- Suggestion engine: "Based on your workflow, you might want to add a rule for X"

### 5.4 Email Sequence AI

AI-powered email drip campaigns.

- Define goal: "nurture cold lead to book a demo"
- AI generates email sequence (3-5 emails) with optimal timing
- Personalization: each email uses contact/company data
- Auto-adjusts: if contact replies, pause sequence and notify agent
- A/B test subject lines and content automatically

---

## 6. Analytics & Reporting

### 6.1 Natural Language Reports

Ask questions in plain text, get reports.

- "How many deals did we close last month?"
- "Which agent has the best conversion rate?"
- "Show me all contacts from Telegram who haven't been contacted in 2 weeks"
- AI translates to query → runs against data → returns formatted answer + chart
- Save frequently asked questions as report templates

### 6.2 Anomaly Detection

AI spots unusual patterns in data.

- "Lead volume from website dropped 40% this week"
- "Agent X response time increased from 2h to 8h"
- "Deal close rate in Q1 is 15% below Q4"
- Weekly digest of anomalies + possible explanations

### 6.3 Agent Performance Insights

AI-analyzed agent performance beyond basic metrics.

- Response quality score (based on customer reactions / sentiment after agent replies)
- Conversation resolution efficiency
- Best performing message templates per agent
- Coaching suggestions: "Agent X could improve by using shorter initial responses — similar pattern to top-performer Agent Y"

---

## 7. Voice & Calls (Novofon / Voximplant)

### 7.1 Call Transcription

Automatic speech-to-text for recorded calls.

- Full transcript attached to conversation
- Searchable across all calls
- Speaker diarization (who said what)

### 7.2 Call Summary & Action Items

AI analyzes call transcript.

- Auto-generates: summary, key decisions, action items, follow-up commitments
- Auto-creates tasks from action items
- Sentiment analysis of the call
- "Customer expressed interest in premium plan, requested proposal by Friday"

### 7.3 Real-Time Call Assist

Live AI suggestions during active calls.

- Relevant knowledge base articles surfaced based on conversation topic
- Objection handling suggestions
- Compliance reminders ("don't forget to mention cancellation policy")
- Requires WebSocket integration with VoIP provider

---

## 8. Platform-Level AI Features

### 8.1 Global Search (Semantic)

AI-powered search across all CRM data.

- "Find the conversation where the client from Gazprom asked about API integration"
- Searches across: contacts, deals, conversations, tasks, notes, call transcripts
- Understands synonyms, context, partial matches
- Ranked by relevance, not just recency

### 8.2 Activity Feed AI Summary

Condensed summary of what happened in the CRM.

- "Today: 12 new leads (3 from Telegram, 9 from web forms), 4 deals moved to Proposal, 1 deal closed ($45K), 2 overdue tasks"
- Customizable per role — manager sees team summary, agent sees personal
- Available as dashboard widget and notification

### 8.3 Data Entry Assist

Reduce manual data entry with AI.

- Paste a business card photo → AI extracts contact info
- Forward an email → AI creates contact + conversation
- Paste a LinkedIn URL → AI fills company/contact fields
- Voice note → AI transcribes and creates task or note

### 8.4 Custom AI Actions (Extensible)

Allow admins to define custom AI actions.

- "Classify this lead by industry" — AI reads contact data and sets custom field
- "Generate proposal outline" — AI creates doc based on deal info
- "Summarize this thread for the client" — AI writes a professional summary email
- Exposed as buttons in the UI, configured in Settings > AI Actions

---

## Implementation Priority

| Priority | Feature | Impact | Effort |
|----------|---------|--------|--------|
| **P0** | 5.1 AI Chatbot | High — automates first-line support | High |
| **P0** | 1.1 AI Auto-Reply / Copilot | High — direct agent productivity boost | Medium |
| **P0** | 5.2 Knowledge Base / RAG | High — foundation for all AI features | High |
| **P1** | 1.2 Conversation Summary | High — saves time on long threads | Low |
| **P1** | 1.3 Sentiment & Intent Detection | Medium — enables smart routing & alerts | Medium |
| **P1** | 4.1 Smart Task Generation | Medium — reduces forgotten follow-ups | Medium |
| **P1** | 7.1 Call Transcription | High — unlocks call data | Medium |
| **P2** | 2.3 Lead Scoring | Medium — improves prioritization | Medium |
| **P2** | 3.1 Deal Win Probability | Medium — improves forecasting | Medium |
| **P2** | 3.2 Deal Risk Alerts | Medium — prevents lost deals | Low |
| **P2** | 4.2 Daily Briefing | Medium — agent productivity | Low |
| **P2** | 6.1 Natural Language Reports | Medium — democratizes analytics | Medium |
| **P2** | 1.4 Auto-Translation | Medium — unlocks multilingual support | Low |
| **P3** | 2.1 Contact Enrichment | Low-Medium — depends on data sources | Medium |
| **P3** | 3.3 Revenue Forecasting | Medium — strategic planning | Medium |
| **P3** | 5.3 NL Automation Rules | Low — current builder works fine | High |
| **P3** | 7.2 Call Summary | Medium — but depends on 7.1 | Low |
| **P3** | 7.3 Real-Time Call Assist | High — but technically complex | High |
| **P3** | 8.1 Semantic Search | Medium — nice-to-have | High |
| **P3** | 8.3 Data Entry Assist | Low — convenience feature | Medium |

---

## Technical Foundation

### LLM Provider Options

| Provider | Pros | Cons |
|----------|------|------|
| **OpenAI (GPT-4o / GPT-4.1)** | Best ecosystem, function calling, embeddings API | Cost, vendor lock-in |
| **Anthropic (Claude)** | Strong reasoning, long context (200K), tool use | Smaller ecosystem |
| **Open Source (Llama, Mistral)** | Self-hosted, no API costs, data privacy | Infra overhead, lower quality |
| **Provider-Agnostic (LiteLLM / Vercel AI SDK)** | Switch providers easily | Extra abstraction layer |

**Recommendation:** Start with OpenAI or Anthropic via Vercel AI SDK (`ai` package) for provider flexibility. Add self-hosted option later for privacy-sensitive deployments.

### Required Infrastructure

1. **Vector Database** — for RAG / knowledge base / semantic search
   - Options: Pinecone, Qdrant (self-hosted), pgvector, Chroma
   - Stores embeddings of knowledge base docs, conversation history, contact data

2. **LLM Gateway** — centralized AI request handling
   - Rate limiting, cost tracking, caching, fallback providers
   - Audit log of all AI calls (for compliance)

3. **Background Job Queue** — for async AI processing
   - Summarization, enrichment, scoring run async
   - Options: BullMQ (Redis-based), or simple in-process queue for prototype

4. **New Data Collections**
   - `knowledgeBaseEntries` — uploaded documents and FAQ
   - `knowledgeBaseChunks` — embedded chunks for RAG
   - `aiConversationSummaries` — cached summaries
   - `leadScores` — computed scores with history
   - `dealPredictions` — win probability snapshots
   - `callTranscripts` — speech-to-text output
   - `aiActionDefinitions` — custom AI action configs
   - `aiUsageLogs` — token usage tracking per user/feature

### Settings UI

New settings section: **Settings > AI Configuration**
- LLM provider selection + API key input
- Per-feature toggles (enable/disable each AI feature)
- AI chatbot configuration (system prompt, knowledge base, handoff rules)
- Cost monitoring dashboard (tokens used, estimated cost)
- Data privacy controls (what data is sent to AI, opt-out per contact)

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
│                                                                  │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────────────────┐ │
│  │ AI Copilot  │ │ AI Chatbot   │ │ AI Insights Panels        │ │
│  │ (Inbox)     │ │ Config (Set) │ │ (Contacts, Deals, Tasks)  │ │
│  └──────┬──────┘ └──────┬───────┘ └────────────┬──────────────┘ │
└─────────┼───────────────┼──────────────────────┼────────────────┘
          │               │                      │
          ▼               ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Backend API (Fastify)                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    AI Service Layer                        │  │
│  │                                                            │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │  │
│  │  │ Copilot  │ │ Chatbot  │ │ Scoring  │ │ Summarizer  │  │  │
│  │  │ Service  │ │ Service  │ │ Service  │ │ Service     │  │  │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬──────┘  │  │
│  │       │             │            │               │         │  │
│  │       ▼             ▼            ▼               ▼         │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │              LLM Gateway (Unified)                  │   │  │
│  │  │  - Provider abstraction (OpenAI / Claude / Local)   │   │  │
│  │  │  - Token counting & cost tracking                   │   │  │
│  │  │  - Rate limiting & retry logic                      │   │  │
│  │  │  - Request/response caching                         │   │  │
│  │  └───────────────────┬─────────────────────────────────┘   │  │
│  │                      │                                     │  │
│  │  ┌──────────────┐    │    ┌────────────────────────┐       │  │
│  │  │ RAG Engine   │◄───┼───►│ Vector DB (Embeddings) │       │  │
│  │  │ (Retrieval)  │    │    │ Knowledge Base Chunks  │       │  │
│  │  └──────────────┘    │    └────────────────────────┘       │  │
│  └──────────────────────┼────────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────┼────────────────────────────────────┐  │
│  │        Existing Services (Contacts, Deals, etc.)          │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────┐  ┌──────────────────┐
│  LLM Provider    │  │  Vector Database  │
│  (OpenAI/Claude) │  │  (Qdrant/Pinecone)│
└──────────────────┘  └──────────────────┘
```
