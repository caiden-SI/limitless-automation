// Student Onboarding Agent — conversational Claude-powered intake.
// Replaces Scott's Google Form. Students access via /onboard?student=X&campus=Y.
//
// All conversation state lives server-side in onboarding_sessions table.
// The client sends only the latest message — state is never trusted from the client.
// Claude drives the conversation through 6 sections, one question at a time.
// On completion, synthesizes an 8-section context document and writes to Supabase.

const { askConversation, ask } = require('../lib/claude');
const { supabase } = require('../lib/supabase');
const { log } = require('../lib/logger');
const { scrapeProfileVideos } = require('../tools/scraper');

const AGENT_NAME = 'onboarding';

// ---------------------------------------------------------------------------
// Section & question definitions
// ---------------------------------------------------------------------------

const SECTIONS = [
  {
    id: 1,
    name: 'BUSINESS CONTEXT',
    questions: [
      { key: 'brand_name', text: 'What is your brand name?' },
      { key: 'project_stage', text: 'What stage is your project in? (Idea/Planning, Building/Developing, Testing with users, or Live with active users)' },
      { key: 'what_it_does', text: 'What does your project do? Explain it like you\'re telling a friend.' },
      { key: 'problem_solved', text: 'What problem does it solve? Why does this matter?' },
      { key: 'mission', text: 'What is your mission statement? Who do you serve, what do you do, and why do you exist? (Example: We help teens end toxic relationships so they can focus on education)' },
      { key: 'vision', text: 'Where do you want to be in 5 years?' },
      { key: 'product_type', text: 'What type of product is this? (physical product, digital product, software, service, course, etc.)' },
      { key: 'current_users', text: 'Do you have any current active users or customers? If so, roughly how many?' },
      { key: 'key_features', text: 'What are the main features or capabilities?' },
      { key: 'access_and_pricing', text: 'How do people access it, what does it cost, is there a free trial?' },
      { key: 'uvp', text: 'What makes this different from alternatives? Why should someone choose this over anything else?' },
      { key: 'testimonials', text: 'Do you have any customer testimonials? If yes, share up to 3. If not, totally fine — just say no.', optional: true },
    ],
  },
  {
    id: 2,
    name: 'PERSONAL BRAND CONTEXT',
    questions: [
      { key: 'origin_story', text: 'Why did you start this project? What\'s the personal story or aha moment behind it?' },
      { key: 'biggest_challenge', text: 'What\'s been your biggest challenge building this?' },
      { key: 'content_quantity', text: 'How much existing content do you have in your camera roll? (None, Some, or A lot)' },
      { key: 'content_types', text: 'What kind of existing photo and video do you have? (selfie/UGC, screen recordings, user testimonials, b-roll of you working, etc.)' },
      { key: 'long_form_transcripts', text: 'Have you done any long-form interviews, keynotes, or podcasts? If yes, paste up to 3 transcripts here.', optional: true },
      { key: 'short_form_transcripts', text: 'Do you have any existing short-form content with proven engagement? If yes, paste up to 3 transcripts.', optional: true },
    ],
  },
  {
    id: 3,
    name: 'INDUSTRY AUTHORITY',
    questions: [
      { key: 'niche', text: 'Define your niche: Industry + Specialty + Product type + Audience. (Example: Self-improvement dating coaching for teens)' },
      { key: 'influencers', text: 'Who are your 3–5 influencers on your hit list? For each, give the @ handle and a link to their profile.' },
    ],
  },
  {
    id: 4,
    name: 'AUDIENCE CONTEXT',
    questions: [
      { key: 'ideal_customer', text: 'Describe your ideal customer.' },
      { key: 'motivation_1_what', text: 'What is the first thing your ideal customer thinks about when they wake up?' },
      { key: 'motivation_1_why', text: 'Why do they think about that?' },
      { key: 'motivation_2_what', text: 'What gets them through the day?' },
      { key: 'motivation_2_why', text: 'Why does that get them through the day?' },
      { key: 'desire_1_what', text: 'What do they daydream about?' },
      { key: 'desire_1_why', text: 'Why do they daydream about that?' },
      { key: 'desire_2_what', text: 'What did they wish they had?' },
      { key: 'desire_2_why', text: 'Why do they wish they had that?' },
      { key: 'pain_1_what', text: 'What is the most annoying thing they deal with daily or weekly?' },
      { key: 'pain_1_why', text: 'Why is it painful or annoying for them?' },
      { key: 'pain_2_what', text: 'What is the most painful experience they have had? (Not physical)' },
      { key: 'pain_2_why', text: 'Why was it painful?' },
      { key: 'fear_1_what', text: 'What is something they hope no one ever finds out about them?' },
      { key: 'fear_1_why', text: 'Why do they want to keep that a secret?' },
      { key: 'fear_2_what', text: 'What have they avoided for years?' },
      { key: 'fear_2_why', text: 'Why have they avoided it for so long?' },
    ],
  },
  {
    id: 5,
    name: 'CONTENT CREATION CONTEXT',
    questions: [
      { key: 'content_pillars', text: 'What types of content would showcase your project best? Pick all that apply: Product demos/tutorials, Behind-the-scenes of building, User testimonials/reactions, My personal story/journey, Educational content in my niche.' },
      { key: 'creator_references', text: 'Who are some content creators you like watching? These are just style references — accounts or creator names.' },
      { key: 'topics_to_avoid', text: 'Are there any topics you completely avoid posting about?' },
    ],
  },
  // Section 6 (Industry Report) is fully automated — no questions for the student.
];

// Flat list of all questions for index-based navigation
const ALL_QUESTIONS = SECTIONS.flatMap((s) => s.questions.map((q) => ({ ...q, section: s.id, sectionName: s.name })));

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Get or create an onboarding session for this student+campus.
 */
async function getOrCreateSession(studentId, campusId) {
  const { data: existing, error: qErr } = await supabase
    .from('onboarding_sessions')
    .select('*')
    .eq('student_id', studentId)
    .eq('campus_id', campusId)
    .maybeSingle();

  if (qErr) throw new Error(`Session query failed: ${qErr.message}`);
  if (existing) return existing;

  const { data: created, error: iErr } = await supabase
    .from('onboarding_sessions')
    .insert({
      student_id: studentId,
      campus_id: campusId,
      current_section: 1,
      current_question_index: 0,
      answers: {},
      influencer_transcripts: [],
      conversation_history: [],
    })
    .select('*')
    .single();

  if (iErr) throw new Error(`Session create failed: ${iErr.message}`);
  return created;
}

/**
 * Update session state in Supabase.
 */
async function updateSession(sessionId, updates) {
  const { error } = await supabase
    .from('onboarding_sessions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) throw new Error(`Session update failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(studentName, answers, currentQuestion, currentSection) {
  const answeredKeys = new Set(Object.keys(answers));
  const sectionList = SECTIONS.map((s) => {
    const answeredInSection = s.questions.filter((q) => answeredKeys.has(q.key));
    const mark = answeredInSection.length === s.questions.length ? '✓' : `${answeredInSection.length}/${s.questions.length}`;
    return `  Section ${s.id}: ${s.name} [${mark}]`;
  }).join('\n');

  return `You are a friendly onboarding assistant for Limitless Media Agency. You are helping ${studentName} build their content strategy context document.

Your job is to collect information through natural conversation — one question at a time.

PROGRESS:
${sectionList}
Currently on: Section ${currentSection}

THE QUESTION YOU NEED TO ASK OR FOLLOW UP ON:
Key: ${currentQuestion.key}
Text: ${currentQuestion.text}
${currentQuestion.optional ? '(This question is optional — skip gracefully if they say they don\'t have it)' : ''}

RULES:
- Ask ONE question at a time. Never dump multiple questions.
- For What/Why pairs: ask the What first, wait for the response, then ask the Why.
- If the student gives a vague or one-word answer, probe ONCE with a friendly follow-up like "Can you tell me a bit more about that?"
- Be warm, encouraging, and conversational — not clinical or form-like.
- If a question is optional and the student says they don't have it, skip gracefully and move on.
- Never repeat a question that was already answered.
- Keep your messages concise — one idea per message. 2-3 sentences max.
- When transitioning between sections, give a brief encouraging note like "Great, that wraps up the business context! Now let's talk about your personal brand."
- Do NOT explain the overall process or how many sections there are unless the student asks.
- Do NOT say "Question 3 of 12" or anything like that — just ask naturally.
- Do NOT include any hidden comments, state markers, or metadata in your response. Just write your conversational message.`;
}

// ---------------------------------------------------------------------------
// Influencer transcript scraping (Section 3)
// ---------------------------------------------------------------------------

/**
 * Parse influencer handles/URLs from the student's answer.
 */
function parseInfluencers(text) {
  const influencers = [];
  const lines = text.split(/\n|,|;/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
    const handleMatch = line.match(/@([\w.]+)/);

    let platform = null;
    let url = urlMatch ? urlMatch[1] : null;
    const handle = handleMatch ? handleMatch[1] : null;

    if (url) {
      if (url.includes('tiktok.com')) platform = 'tiktok';
      else if (url.includes('instagram.com')) platform = 'instagram';
      else if (url.includes('youtube.com') || url.includes('youtu.be')) platform = 'youtube';
    }

    if (handle || url) {
      influencers.push({ handle: handle || url, url, platform });
    }
  }

  return influencers.slice(0, 5);
}

/**
 * Attempt to scrape transcripts for each influencer.
 */
async function fetchInfluencerTranscripts(influencers, campusId) {
  const results = [];

  for (const inf of influencers) {
    if (!inf.url || !inf.platform || inf.platform === 'youtube') {
      results.push({ handle: inf.handle, success: false, reason: 'no_scrapeable_url' });
      continue;
    }

    try {
      const videos = await scrapeProfileVideos(inf.url, inf.platform, 3);
      const transcripts = videos
        .filter((v) => v.transcript || v.description)
        .map((v) => v.transcript || v.description)
        .slice(0, 3);

      if (transcripts.length > 0) {
        results.push({ handle: inf.handle, success: true, transcripts });
      } else {
        results.push({ handle: inf.handle, success: false, reason: 'no_transcripts_found' });
      }
    } catch (err) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'influencer_scrape_failed',
        status: 'warning',
        errorMessage: err.message,
        payload: { handle: inf.handle },
      });
      results.push({ handle: inf.handle, success: false, reason: err.message });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Industry report generation (Section 6 — fully automated)
// ---------------------------------------------------------------------------

async function generateIndustryReport(niche, influencerHandles) {
  const influencerList = influencerHandles.length > 0
    ? `Key influencers in this space: ${influencerHandles.join(', ')}`
    : '';

  return ask({
    system: 'You are a market research analyst. Write a concise industry report (400-600 words) in markdown format.',
    prompt: `Write an industry report for this niche: "${niche}"

${influencerList}

Cover these four areas:
1. **Why this problem exists** — the root causes and systemic issues
2. **Current solutions and their limitations** — what's available today and where it falls short
3. **Competitive landscape** — who the key players are and how they're positioned
4. **Growth trends and market opportunity** — where the market is headed and why now is the right time

Be specific and actionable. Use real industry context where possible.`,
    maxTokens: 1500,
  });
}

// ---------------------------------------------------------------------------
// Context document synthesis
// ---------------------------------------------------------------------------

async function synthesizeContextDocument(studentName, answers, influencerTranscripts, industryReport) {
  const influencerSection = influencerTranscripts
    .filter((r) => r.success)
    .map((r) => `**@${r.handle}** — ${r.transcripts.length} transcript(s) collected`)
    .join('\n');

  const failedInfluencers = influencerTranscripts
    .filter((r) => !r.success)
    .map((r) => `@${r.handle}`)
    .join(', ');

  const prompt = `Synthesize the following student onboarding data into a structured context document.

STUDENT NAME: ${studentName}

RAW ANSWERS:
${JSON.stringify(answers, null, 2)}

INFLUENCER TRANSCRIPTS COLLECTED:
${influencerSection || 'None collected via scraping'}
${failedInfluencers ? `Could not scrape: ${failedInfluencers}` : ''}

INFLUENCER TRANSCRIPT CONTENT:
${influencerTranscripts
  .filter((r) => r.success)
  .map((r) => `@${r.handle}:\n${r.transcripts.join('\n---\n')}`)
  .join('\n\n') || 'None available'}

INDUSTRY REPORT:
${industryReport || 'Not generated'}

Create the context document using EXACTLY these 8 sections. Use the student's own words wherever possible, especially for the origin story. Be thorough — this document will be used as the foundation for all content strategy.

### 1. STUDENT & BRAND IDENTITY
Student name, brand name, project stage, social presence (handles and platforms), total following

### 2. BUSINESS OVERVIEW
Product type, what it does (2–3 plain language sentences), project stage, current users/customers, key features, user access and pricing

### 3. PROBLEM & SOLUTION FRAMEWORK
Problem being solved, mission statement, vision statement, unique value proposition

### 4. AUDIENCE DEEP DIVE
Ideal customer description, all motivations with Why, all desires with Why, all pain points with Why, all fears with Why

### 5. FOUNDER STORY & PERSONAL BRAND
Origin story (use the student's exact words), biggest challenge, personal brand positioning analysis

### 6. INDUSTRY AUTHORITY & NICHE
Defined niche, top influencers list with handles and links, influencer content analysis from transcripts, industry report

### 7. CONTENT CREATION CONTEXT
Preferred content pillars, content creator references, topics to avoid, existing content inventory (long-form yes/no, short-form yes/no), available assets (quantity and types), proven short-form scripts if provided, customer testimonials if provided

### 8. CONTENT STRATEGY IMPLICATIONS
On-camera comfort assessment based on their answers, optimal content approach (2–3 sentences), key storytelling angles (2–3 most compelling narratives), production constraints and opportunities, priority content pillars ranked 1–5 for their situation`;

  return ask({
    system: 'You are a content strategist synthesizing a student context document. Output clean markdown. Be thorough and use the student\'s own words where possible.',
    prompt,
    maxTokens: 4096,
  });
}

// ---------------------------------------------------------------------------
// Database writes
// ---------------------------------------------------------------------------

async function writeToSupabase({ studentId, campusId, contextDocument, answers }) {
  const handles = {};
  const allText = Object.values(answers).join(' ');
  const tiktokMatch = allText.match(/@([\w.]+).*tiktok/i) || allText.match(/tiktok.*@([\w.]+)/i);
  const igMatch = allText.match(/@([\w.]+).*instagram/i) || allText.match(/instagram.*@([\w.]+)/i);
  const ytMatch = allText.match(/@([\w.]+).*youtube/i) || allText.match(/youtube.*@([\w.]+)/i);

  if (tiktokMatch) handles.handle_tiktok = tiktokMatch[1];
  if (igMatch) handles.handle_instagram = igMatch[1];
  if (ytMatch) handles.handle_youtube = ytMatch[1];

  const { error } = await supabase
    .from('students')
    .update({
      claude_project_context: contextDocument,
      onboarding_completed_at: new Date().toISOString(),
      ...handles,
    })
    .eq('id', studentId);

  if (error) throw new Error(`Supabase update failed (students): ${error.message}`);

  await log({
    campusId,
    agent: AGENT_NAME,
    action: 'onboarding_complete',
    payload: { studentId, handles: Object.keys(handles) },
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle a single message in the onboarding conversation.
 * State is read from and written to onboarding_sessions — never from the client.
 *
 * @param {object} params
 * @param {string} params.studentId - Student UUID
 * @param {string} params.campusId - Campus UUID
 * @param {string} params.studentName - Student display name
 * @param {string} params.message - Latest user message (empty string for initial greeting)
 * @returns {{ reply: string, section: number, isComplete: boolean, contextDocument: string|null }}
 */
async function handleMessage({ studentId, campusId, studentName, message }) {
  // Load or create server-side session
  const session = await getOrCreateSession(studentId, campusId);
  const answers = session.answers || {};
  const history = session.conversation_history || [];
  let questionIndex = session.current_question_index;

  // ------ First message: send greeting, ask first question ------
  if (history.length === 0 && !message) {
    const currentQ = ALL_QUESTIONS[0];
    const greeting = `Hey ${studentName}! I'm here to help build your content strategy profile. I'll ask you some questions about your project, your story, and your audience — should take about 15-20 minutes.\n\nLet's start with the basics. What's the name of your brand or project?`;

    const newHistory = [{ role: 'assistant', content: greeting }];
    await updateSession(session.id, {
      conversation_history: newHistory,
      current_section: currentQ.section,
      current_question_index: 0,
    });

    return {
      reply: greeting,
      section: currentQ.section,
      isComplete: false,
      contextDocument: null,
    };
  }

  // ------ Record the user's message ------
  if (message) {
    history.push({ role: 'user', content: message });
  }

  // ------ Store the answer for the current question ------
  const currentQ = ALL_QUESTIONS[questionIndex];
  if (message && currentQ) {
    if (answers[currentQ.key]) {
      answers[currentQ.key] += '\n' + message;
    } else {
      answers[currentQ.key] = message;
    }
  }

  // ------ Handle influencer scraping (Section 3) ------
  let influencerMessage = '';
  let influencerTranscripts = session.influencer_transcripts || [];

  if (currentQ && currentQ.key === 'influencers' && message) {
    const influencers = parseInfluencers(message);
    if (influencers.length > 0) {
      try {
        const results = await fetchInfluencerTranscripts(influencers, campusId);
        influencerTranscripts = results;
        const succeeded = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        if (succeeded.length > 0) {
          influencerMessage = `I was able to pull transcripts for ${succeeded.map((r) => '@' + r.handle).join(', ')}. `;
        }
        if (failed.length > 0) {
          influencerMessage += `I wasn't able to grab content from ${failed.map((r) => '@' + r.handle).join(', ')} automatically. If you have any transcript text from them, feel free to paste it. Otherwise, no worries — we can move on.`;
        }

        // Persist influencer transcripts immediately
        await updateSession(session.id, {
          influencer_transcripts: influencerTranscripts,
        });
      } catch (err) {
        await log({
          campusId,
          agent: AGENT_NAME,
          action: 'influencer_scrape_batch_error',
          status: 'warning',
          errorMessage: err.message,
        });
      }
    }
  }

  // ------ Advance to next question ------
  const nextIndex = questionIndex + 1;
  const isComplete = nextIndex >= ALL_QUESTIONS.length;

  if (!isComplete) {
    const nextQ = ALL_QUESTIONS[nextIndex];

    // Build system prompt with server-side state
    const systemPrompt = buildSystemPrompt(studentName, answers, nextQ, nextQ.section);

    // If we have an influencer scrape message, inject it before Claude's turn
    if (influencerMessage) {
      history.push({ role: 'assistant', content: influencerMessage });
    }

    const reply = await askConversation({
      system: systemPrompt,
      messages: history,
      maxTokens: 512,
    });

    history.push({ role: 'assistant', content: reply });

    // Persist all state
    await updateSession(session.id, {
      current_section: nextQ.section,
      current_question_index: nextIndex,
      answers,
      conversation_history: history,
    });

    return {
      reply,
      section: nextQ.section,
      isComplete: false,
      contextDocument: null,
    };
  }

  // ------ All questions complete — generate outputs ------

  // Generate industry report (Section 6 — automated)
  let industryReport = session.industry_report || '';
  if (!industryReport) {
    try {
      industryReport = await generateIndustryReport(
        answers.niche || '',
        influencerTranscripts.filter((r) => r.success).map((r) => r.handle),
      );
      await updateSession(session.id, { industry_report: industryReport });
    } catch (err) {
      await log({
        campusId,
        agent: AGENT_NAME,
        action: 'industry_report_error',
        status: 'warning',
        errorMessage: err.message,
      });
      industryReport = 'Industry report generation failed.';
    }
  }

  // Synthesize context document from persisted data
  const contextDocument = await synthesizeContextDocument(
    studentName,
    answers,
    influencerTranscripts,
    industryReport,
  );

  // Write to students table
  await writeToSupabase({ studentId, campusId, contextDocument, answers });

  // Final session update
  await updateSession(session.id, {
    answers,
    conversation_history: history,
    industry_report: industryReport,
  });

  return {
    reply: 'Your context is ready!',
    section: 6,
    isComplete: true,
    contextDocument,
  };
}

module.exports = { handleMessage };
