export const FACT_EXTRACTION_PROMPT = `Extract EVERY SINGLE MINUTIA and EVERY FACT from this message. COMPLETE EXHAUSTIVENESS is mandatory. Do not filter for "significance"—if it was mentioned, it is a fact. Include entities and anchor EVERY fact to a specific date/time.

For each fact, classify it as:
- FACT: Ground-truth details, preferences, decisions, claims, or events.
- CORRECTION: User correcting/clarifying something they said before
- EXAMPLE of FACTS and CORRECTIONS:
  - Message A: Current Date: [March 14, 2024] John said that Alex has a new job at TechCorp -> FACT: [March 14, 2024] [Alex] started a new job at [TechCorp]
  - Message B: Current Date: [March 15, 2024] Alex clarified that his new job is actually at CorpTech -> CORRECTION: [March 15, 2024] [Alex] actually started a new job at [CorpTech], not [TechCorp]

** Format (STRICT) **
-  TYPE: [DATE] [ENTITY NAME] fact text
- **DATE FORMAT:** ALL dates in brackets [ ] MUST be in Month DD, YYYY format (e.g., [March 15, 2024]). Convert any other formats (e.g., "2024-03-15", "15/03/2024") to Month DD, YYYY.
- **ENTITY FORMAT:** ALL entity names in brackets [ ] MUST be in [ENTITY NAME] format (e.g., [John]). Convert any other formats (e.g., "John", "john") to [ENTITY NAME].

**CRITICAL RULES:**
1. **TOPIC RESOLUTION (MANDATORY):** 
a) EVERY message must be contextualized. 
b) Use the "Conversation Context" to replace ambiguous words (it, that, the plan, the activity, the item, the event) with the **SPECIFIC name** of the subject discussed previously. 
c) Avoid generic descriptors or "disconnected" claims such as "[name] said 'okay'" - you must connect to WHAT exactly that "okay" refer to - include both the specific topic AND the reference to the previous message.
Examples 1:
   - [Current Date Dec 11th 2023] [Speaker A] "I tried a new workout yesterday. Check out my glutes!" -> FACT: [Dec 10th 2023] [Speaker A] tried a new workout [mentioned as "yesterday" on Dec 11th 2023].
   - [Current Date Dec 11th 2023] [Speaker B] "Yeah, they're pumped!" -> FACT: [Dec 11th 2023] [Speaker B] observed that Speaker A's glutes look pumped [in relation to the workout tried on Dec 10th 2023].

2. **PRESERVE EXACT DETAILS (MANDATORY):** When the user mentions a specific name, title, number, or quote, include it VERBATIM. Do NOT generalize or paraphrase specific details.

3. **CONTEXTUAL SYNTHESIS (MANDATORY):** EACH TURN AND MESSAGE has significant context, and even a short message might clarify the previous one or provide other kind of a critical detail. Always look at the previous messages in the current session to find out if there were key details before that CLARIFY what this message is about, OR if this message clarifies what the PREVIOUS one was about. Never allow specific modifiers or identifiers to be lost to generic summarization.

4. **TEMPORAL RESOLUTION (MANDATORY):** YOU MUST CALCULATE THE DATE BASED ON THE CURRENT DATE AND RELATIVE EXPRESSION. THE RELATIVE EXPRESSION ITSELF MUST BE ADDED AS METADATA.
   - **LITERAL CALENDAR DATE INTERPRETATION (STRICT):** Interpret the [CURRENT DATE] provided in the system prompt LITERALLY. 00:00 (Midnight) on December 1 is December 1. Do not adjust for "late-night" or "emotional" context. Always calculate relative references (yesterday, last night, today) based strictly on that calendar date.

   - **IF THERE IS NO RELATIVE EXPRESSION OR DATE REFERENCE IN THE MESSAGE:** Use the [DATE] provided in the CONTEXT for ALL facts where no other date OR relative expression is mentioned
     EXAMPLE: 
     - Context: Current Date: "March 15, 2024" | Speaker: "I just started X" -> FACT: [March 15, 2024] [Speaker] started X
     - UNLESS the date was already resolved in a previous message.**

   
   - **For RELATIVE or DURATION references:**
      
      **A) Day/Week/Specific Intervals** (PAST: "yesterday", "last week", "5 days ago", "for 3 days", etc. | FUTURE: "tomorrow", "next week", "in 2 days", etc.):
         a) **CALCULATE THE EXACT DATE**: Subtract/add the time from [CURRENT DATE].
         b) Use that **CALCULATED ACTUAL DATE** as the [DATE] in brackets.
         c) **REPHRASE FOR DURATIONS**: If a duration is used (e.g., "for 3 days"), rephrase to describe the **START** (e.g., "started", "began").
         d) **METADATA**: ALWAYS end with "[mentioned as "[EXPRESSION]" on [CURRENT DATE]]".
         
         EXAMPLE: [Current: May 20] "I went to the gym yesterday" -> FACT: [May 19, 2024] [Speaker] went to the gym [mentioned as "yesterday" on May 20, 2024].
         EXAMPLE (Duration): [Current: Jan 10] "I've been sick for 3 days" -> FACT: [January 7, 2024] [Speaker] started being sick [mentioned as "for 3 days" on January 10, 2024].

      **B) Year/Multi-Month Intervals** (PAST: "last year", "3 years ago", "for 2 years", "the past 6 months", etc.):
         a) **CALCULATE THE STARTING POINT**: Subtract the time from [CURRENT DATE] to find the year/month the action began.
         b) Use the **CALCULATED START YEAR or MONTH** as the [DATE] in brackets.
         c) **MANDATORY TRANSFORMATION (STRICT)**: If a duration (e.g., "for 3 years") is used, you MUST rephrase the fact to describe the **START** (e.g., "started", "began", "obtained", "moved in") instead of the duration.
         d) **METADATA**: ALWAYS end with "[mentioned as "[EXPRESSION]" on [CURRENT DATE]]".
         
         EXAMPLE: [Current: June 2024] "I moved here last year" -> FACT: [2023] [Speaker] moved here [mentioned as "last year" on June 25, 2024].
         EXAMPLE: [Current: Jan 2022] "I've had turtles for 3 years" -> FACT: [2019] [Speaker] obtained turtles [mentioned as "for 3 years" on January 23, 2022].

   - **THE DURATION TRAP (CRITICAL):** Do NOT anchor facts with durations (e.g., "for 5 years", "the past 6 months") to the [CURRENT DATE]. These are **HIDDEN START DATES**. 
     - ❌ WRONG: [Jan 2022] [User] has lived here for 2 years.
     - ✅ CORRECT: [2020] [User] started living here [mentioned as "for 2 years" on Jan 2022].

   - **TEMPORAL INHERITANCE (CRITICAL):** If a message relates to an event/plan that was given a resolved date earlier in the conversation, anchor that fact to the SAME resolved date. This applies to BOTH past and future references. HOWEVER be cautious - as if the message is NOT directly linked to that same event - DO NOT use this rule.
      - FUTURE example: Message A on March 14 says "Let's meet tomorrow" (resolved to March 15) and message B says "I'll bring the documents" -> documents fact anchored to [March 15, 2024] as it relates to the same event.
      - PAST example: Message A on March 14 says "I went hiking yesterday" (resolved to March 13) and message B says "I saw a bear there" -> bear sighting fact anchored to [March 13, 2024] as it relates to the same event.
      - EXCEPTION: Observations or claims related to the TOPIC of the event, but not to the event directly: On December 12th Speak A says "I organized a party last night" (resolved to Dec 11th) and speaker B (Dec 12) says "Yeah I loved it. It was great" - this fact is anchored to Dec 12th, for example "[Dec 12, 2024] [Name] says the party was great, referring to Speaker A's party on Dec 11th."
      - DO NOT overuse it!

   - 🚨 **DURATION ENFORCEMENT RULE (NON-NEGOTIABLE):**
     If a fact contains ANY duration expression ("for X years", "for X months", "since", "over the past"):
     1. You MUST compute the **START date**.
     2. You MUST rewrite the verb to a **START verb** ("started", "began", "obtained", "moved in", "initiated").
     3. You MUST NOT anchor the fact to the CURRENT DATE.
     4. **The [DATE] in brackets MUST NOT equal the [CURRENT DATE] for these facts.**

   - **FINAL VALIDATION (MANDATORY):**
     - Scan all generated facts.
     - If any fact contains a duration phrase AND its [DATE] equals the [CURRENT DATE] -> **STOP AND RE-CALCULATE.** This is a system error. 
     - Do not output the list until every duration is resolved to its START DATE.


5. Tag major life events (job loss, birth, death, marriage, career change) as [CRITICAL] before the date.

6. If no facts are present, return 'NONE'.`;

export const CONCEPT_EXTRACTION_PROMPT = `Extract key concepts, definitions, opinions, and views from this text. 
For each item, classify it as:
- concept: general ideas, topics, or entities
- definition: explanations of what something means
- opinion: personal views or judgments  
- view: perspectives or stances on topics

Return as JSON array with format: [{"text": "concept text", "type": "concept|definition|opinion|view", "confidence": 0.8}]
Only extract significant, memorable items. Return empty array if none found.`;

export const RELATIONSHIP_EXTRACTION_PROMPT = `Identify relationships between these concepts based on the original text.
Use these relationship types:
- relates-to: general connection
- contradicts: opposing ideas
- causes: causal relationship  
- supports: supporting evidence
- defines: definitional relationship

Return as JSON array: [{"source": "concept1", "target": "concept2", "relationship": "relates-to", "confidence": 0.8}]
Only include clear, meaningful relationships. Return empty array if none found.`;

export const QUERY_ANALYSIS_PROMPT = `Analyze the user's query and history to determine the depth of memory retrieval needed and extract a REFINED search query.

DEPTH CATEGORIES:
SURFACE: Simple greetings, chitchat, or questions about the *immediate* current moment only (e.g., "hi", "how are you", "what time is it now", "thanks").
DEEP: Asking about stored information, past details, specific events, "when did X happen", "who is Y", projects, or preferences. IF IN DOUBT, CHOOSE DEEP.
GLOBAL_DEEP: Searching across all past conversation patterns, corrections, or comprehensive history.
COUNTING: Specifically asking for a numerical quantity (e.g., "how many", "total count of"). DO NOT use this for "top 3", "main themes", or "best examples" — those are DEEP or GLOBAL_DEEP. **DO NOT use this for frequency questions ("how often").**
FREQUENCY: Asking for habits, recurring schedules, rates, or frequency of events (e.g., "how often", "how frequently", "do I usually", "is it common").
CONCEPTUAL: Asking for feelings, opinions, perspectives, or high-level summaries/themes across conversations.

REFINED SEARCH QUERY:
If the user's query is relative (e.g., "what specifically did I ask?", "tell me more about it"), extract the actual TOPIC from the recent history.
If the user asks for "themes", the search query should be the broad topic of recent conversation.

FOLLOW-UP DETECTION:
Set isFollowUp to true if the current query refers back to previous turns using words like:
- "it", "that", "those", "the same", "more about", "specifically", "exactly", "which ones"

Return JSON only:
{
  "depth": "SURFACE" | "DEEP" | "GLOBAL_DEEP" | "COUNTING" | "FREQUENCY" | "CONCEPTUAL",
  "searchQuery": "refined search string for vector embeddings",
  "isFollowUp": true | false
}`;

export const SYSTEM_PROMPT = `You are an AI assistant using MIRA persistent memory. You can remember relevant user context across conversations when it is provided below.

**Core Principle: You ALWAYS have context.**
- Your memory is provided below. USE IT.
- Never say "I don't have access to past conversations" — you DO have access via your memory.
- Never say "I don't remember" without first checking the provided context.
- If something isn't in your memory, say "I don't have that recorded yet" not "I can't access that."

**Memory Usage:**
- CORE_MEMORY contains key facts about the user, their projects, and preferences — always reference this.
- RETRIEVED_CONTEXT contains relevant facts/entities based on the current query — use these naturally.
- Timestamps are provided — you know WHEN things happened.

**Memory Reasoning Policy:**
- Treat retrieval and reasoning as one memory loop: use the retrieved context to answer, not as loose suggestions.
- Use resolved dates as the source of truth for temporal answers.
- Give explicit corrections and correction-style clarifications priority over older conflicting summaries.
- Prioritize exact retrieved messages when the user asks what they said, asked, wrote, or corrected.
- Preserve semantic continuity across sessions: connect the same ongoing topic, entity, plan, or event when the context supports it.
- Resolve entity/category references naturally: if the user asks for a broader category and memory contains a specific matching instance, use the specific instance.
- For list/count/commonality questions, include all distinct items supported by memory; do not stop at the first match.
- Synthesize across facts when the question requires relationships, themes, timelines, or multi-hop reasoning.

**Conversation Style:**
- Be conversational and natural, not robotic.
- Mirror the user's tone and energy.
- Don't over-explain or ask unnecessary clarifying questions.
- If the context makes something obvious, just respond directly.

**When referencing memory:**
- **TEMPORAL QUESTIONS (CRITICAL)**: When asked "When did X happen?":
  1. Look at the [DATE] timestamp on the relevant fact - that IS the event date/time.
  2. **DO NOT recalculate** from any relative phrases that may appear in the fact text.
  3. The [DATE] has already been resolved to the actual event date. Trust it completely.
  4. Answer formats:
     - If [DATE] is a full date (e.g., "[June 15, 2024]"), answer: "June 15, 2024"
     - If [DATE] is a year only (e.g., "[2022]"), answer: "2022" (do NOT try to find a specific date within that year)
  5. **NEVER perform date arithmetic** - the fact's [DATE] is the source of truth. If you see "yesterday" or "last year" in the fact text, ignore it - the [DATE] is already correct.
  
- **Confidence Rule:** NEVER start a response with "I don't find anything about [X]" or "There are no mentions of [X]" if there is *any* other information in CORE_MEMORY or RETRIEVED_CONTEXT. Instead, focus on what YOU DO KNOW.
- **Synthesis:** If the user asks for "themes" or "summaries," look across CORE_MEMORY and recent fact summaries to synthesize an answer. Avoid being a literal search engine; be a synthesized brain.
- **Correction Priority:** If retrieved facts include a fact marked CORRECTION or a correction-style clarification, treat it as newer guidance over older conflicting summaries. Acknowledge the correction naturally when relevant.
- **Source of Truth:** If the user asks "what did I say/ask", prioritize **Retrieved Messages (Exact Wording)**. Use their exact words.
- **IDENTITY MAPPING**: In 'Retrieved Messages', the [assistant] role represents the conversational partner, and the [user] role represents the human user.
- **STRICT SUBJECT FOCUS**: Identify the exact subject of the question. Answer that specifically. Do NOT override specific historical details with broad thematic summaries. 
- **CONCISENESS**: Keep responses direct and focused on the answer. One or two clear sentences are often better than lengthy summaries.`;

export const ENTITY_EXTRACTION_PROMPT = `Extract entities from this conversation. For each entity, provide:
- name: short identifier (lowercase, no spaces if possible)
- type: one of [project, person, concept, preference, event]
- description: brief context (1 sentence max)

Entity types:
- project: Something the user is building or working on
- person: A person mentioned (colleague, friend, company, etc.)
- concept: An idea, technology, topic, or thing being discussed
- preference: A stated preference or opinion the user has
- event: Something that happened or will happen (meeting, decision, milestone)

Return as JSON array. Only extract SIGNIFICANT, MEMORABLE entities.
If nothing significant, return empty array [].

Example input: "I'm building Atlas, it's a research workspace app. My cofounder Alex loves TypeScript."
Example output: [
  {"name": "atlas", "type": "project", "description": "Research workspace app the user is building"},
  {"name": "alex", "type": "person", "description": "User's cofounder"},
  {"name": "typescript", "type": "preference", "description": "Alex loves TypeScript"}
]`;

export const CORE_MEMORY_UPDATE_PROMPT = `Update the user's core memory based on recent interactions.

Current core memory:
{current_memory}

Recent messages:
{messages}

Generate an updated core memory (max 400 words) with these sections:

## User Profile
- Name (if known)
- Communication style observed
- Any personal details shared

## Active Projects
- List current projects with brief descriptions
- Note the most recent/active one

## Key Preferences
- Stated preferences (tools, styles, approaches)
- Important corrections or clarifications

## Recent Timeline
- Today: [what happened today]
- Yesterday: [summary]
- Earlier: [older context if relevant]

## Major Life Events
- List significant turning points (job loss, moves, relationships, milestones)
- NEVER remove these unless explicitly contradicted
- Keep a permanent record here

Keep entries concise. Use 'Intelligent Recency': prioritize recent info for current plans/status, but strictly honor historical facts for specific past queries. Do not summarize away specific details from older records.`;

export const RELATIONSHIP_EXTRACTION_PROMPT_V2 = `Given these extracted entities, identify relationships between them.

Entities:
{entities}

Original text:
{text}

Relationship types:
- works_on: User works on a project
- uses: Project/person uses a technology/tool
- related_to: General connection between entities
- prefers_over: User prefers X over Y
- part_of: Entity is part of another entity

Return as JSON array:
[{"source": "entity1", "target": "entity2", "type": "relationship_type"}]

Only include clear, meaningful relationships. Return [] if none found.`;

export const CORRECTION_DETECTION_PROMPT = `Analyze if the user is correcting previously stored information or a mistake the AI made.

Look for patterns like:
- "No, it's actually X not Y"
- "I meant X, not Y"
- "That's wrong, it's X"
- "You got that wrong"
- "It's not X, it's Y"
- "I already told you..."
- Explicit corrections of names, facts, or details

If a correction is detected, return JSON:
{
  "is_correction": true,
  "old_value": "what the AI had wrong or what user is correcting",
  "new_value": "the correct information",
  "entity_type": "project|person|concept|preference|event|fact",
  "summary": "Brief description of the correction"
}

If NO correction detected, return:
{"is_correction": false}

Only flag clear, explicit corrections. Casual conversation is NOT a correction.`;

export const COUNTING_STRATEGY_PROMPT = `Analyze a counting query (e.g., "how many times...") and determine the best search strategy.

You must decide:
1. Target table: "messages" (for raw text) or "facts" (for semantic concepts like corrections).
2. Filter: The pattern to search for (ilike pattern for messages, or specific fact_type for facts).
3. Role filter: If counting messages, should we count "user", "assistant", or "all"?

Guidelines:
- If asked about "corrections", target "facts" with fact_type: "correction".
- If asked about specific words/phrases, target "messages" with ilike filter.
- If asked about AI mistakes, target "facts" with fact_type: "correction".
- Extract the cleanest possible search term. (e.g., if asked "something about Atlas", extract just "Atlas").
- DO NOT include filler phrases like "something about", "anything about", "mentions of" in the pattern.

Return JSON only:
{
  "target": "messages" | "facts",
  "pattern": "string",
  "fact_type": "string" (optional),
  "role": "user" | "assistant" | "all" (optional, default "all"),
  "semantic": boolean (optional, use true for concepts like "ideas", "thoughts", "plans", "feedback")
}

Example 1: "how many times did I call u a genius"
{"target": "messages", "pattern": "genius", "role": "user", "semantic": false}

Example 2: "how many times did I correct you"
{"target": "facts", "fact_type": "correction"}

Example 3: "how many times did I send you anything about Atlas"
{"target": "messages", "pattern": "Atlas", "role": "user", "semantic": true}

Example 4: "how many times did you provide any ideas on the project"
{"target": "messages", "pattern": "ideas", "role": "all", "semantic": true}

Example 5: "how many times did you use an em dash"
{"target": "messages", "pattern": "—", "role": "assistant", "semantic": false}
`;
