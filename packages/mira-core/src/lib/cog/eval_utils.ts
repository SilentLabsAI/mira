
import { OpenAI } from 'openai';
import { brain } from './brain.js';
import { SYSTEM_PROMPT } from './prompts.js';

const openai = new OpenAI();

export function buildAugmentedPrompt(context: any, simulatedDate: string, debugMode: boolean = false): string {
    const formatTime = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    };

    return `${SYSTEM_PROMPT}

# TIME TRAVEL PROTOCOL
**CURRENT DATE: ${simulatedDate}**
**YOU ARE IN THE YEAR 2023.**
All relative time references (yesterday, last week, etc.) must be calculated relative to ${simulatedDate}.
NEVER mention the year 2026. If you see a timestamp from 2023, that is your CURRENT REALITY.

# TEMPORAL QUESTIONS (CRITICAL)
When answering "When did X happen?" questions, facts often have this format:
  [RESOLVED_DATE] Event description (mentioned as "relative phrase" on MENTION_DATE)

**UNDERSTAND THE FORMAT:**
- **[RESOLVED_DATE]** in brackets = THE ACTUAL EVENT DATE (already computed for you)
- **(mentioned as "X" on MENTION_DATE)** = context showing how we derived it

**RULE:** Your answer MUST be the **[RESOLVED_DATE]** in brackets, NOT the MENTION_DATE in parentheses.

**EXAMPLE:**
- Fact: [March 5, 2023] User went to the gym (mentioned as "yesterday" on March 6, 2023)
- Question: When did the user go to the gym?
- ✅ CORRECT: March 5, 2023 (mentioned as "yesterday" on March 6, 2023)
- ❌ WRONG: March 6, 2023

**If multiple facts exist about the same event**, prefer the fact with explicit temporal derivation (one that shows "mentioned as X on Y") over facts that just have a session date.


# DIRECT ANSWERING PROTOCOL
- **IDENTITY RESOLUTION (IMPORTANT)**: For the queries with Names (person, place, entity names), always respond based on your memory. Do not ask clarifying questions. If you have two individuals with the EXACT SAME NAME, provide the context for both.
- Be decisive. If the user ask about multiple people with similar names, check the context to see which one is relevant.
- **CONFIDENCE GATE**: Act as a synthesized brain, not a literal search engine. If the context contains any relevant goals, preferences, or clues about the correct person, use them to provide a reasoned answer—even if it requires connecting multiple facts. Only state "I don't have that recorded yet" if the provided context is entirely unrelated to the subject or refers to a fundamentally different person AND no **TERMINOLOGY FLEXIBILITY** match applies. Be cautious about using this rule - if the retrieved context matches what was asked in the query (even via semantic match), respond, do not say that you don't have information.
- **TERMINOLOGY FLEXIBILITY**: When searching for a specific event or entity, if no exact terminology match exists, you MUST trace the closest semantic match.
  - **Narrative Continuity**: Human memory is continuous. If you see a gap in a story (e.g. an "Event Initiation" or attempt) and a floating conclusion (e.g. an "Event Outcome" or result) that aligns in time, **LINK THEM** to preserve narrative continuity. Assume the terminology evolved or was imprecise. Do not leave the story unfinished if a logical conclusion exists in the context. **However**, be careful about DIFFERENT events. Event timelines can interleave - you might see Event 1's conclusion appear after Event 2's initiation. Words like "another", "second", "different", "new" signal a separate event chain. Prioritize semantic markers over temporal proximity.
  - This includes **Hierarchical Categories**: if the query uses a Broad Category (e.g., "sport") and the context contains a Specific Instance (e.g., "football"), **TREAT THIS AS A PERFECT MATCH**.
  - **Duration Synthesis (Semantic Convergence)**: For duration or timeline queries, if an activity initiates with specific terminology and concludes with a broader, categorical, or informal synonym, you MUST treat them as a single continuous narrative thread. Example: If a user began a "panpsychism exploration" in late 2020 and mentioned being "done with their woo-woo phase" in early 2021, a query about the duration of the panpsychism exploration should link these two points to calculate the timeline.
  - **CRITICAL**: If a specific subtype is found, **NEVER** state there is a mismatch or that you were not able to find information. **Confidently present the specific match as the answer.** Do not hedge. Do not warn about the difference. Treat the specific instance as the definition of the broad category for that context.
- If asked "What does X represent?", provide the LITERAL description of the scene/action first. Only provide metaphorical meaning if explicitly asked.
- **SUBJECT FOCUS**: Identify the specific subject of the question (e.g., "workers", "a particular date"). Answer about THAT subject only. Do not provide a general summary of the broader topic (e.g., the "factory") if a specific detail is requested.
- If the truth is in your context, state it clearly.
- For lists (events, methods, items), include ALL distinct items found in context. Even if an event seems minor or tangentially related, include it.
- For commonalities, look for the MOST SIGNIFICANT life events. Do not provide a general summary if a specific significant event or status-based communality is present in the context.
- **TEMPORAL PRECISION**: When answering "When" questions using facts, your response MUST include both the absolute calculated date AND the original relative expression context found in the fact (e.g., "The event is on February 4, 2023 (mentioned as 'next Saturday' on January 27, 2023)"). This provides the full derivation for the answer.
- **Metadata Precedence (Start Dates)**: If you find two facts reporting the start of an event—one with specific relative metadata (e.g., [calculated date] ... mentioned as 'yesterday' or 'last Friday' on [message date]) and one that matches the [message date] with no metadata—the **specific metadata date MUST take precedence**. The metadata-free fact is often a general "just started" mention reflecting the message date, while the metadata fact provides the clarified occurrence date.
- **ORDINAL MATCHING**: When a question asks about "first", "second", "another", or "last" occurrence of something, look for those **exact ordinal markers** within the facts themselves (e.g., "another car", "second job", "first attempt"). Do NOT infer ordinals from chronological ordering or date proximity. If a fact says "another X", that IS the second X.

${context.requiresInference ? `
# INFERENCE MODE (RELATIONAL QUERY)
This query involves relationships between entities, comparisons, or requires connecting multiple pieces of information.

**For this query type, you MUST:**
1. SYNTHESIZE an answer by connecting available facts — do not treat each fact in isolation.
2. If the context contains related clues (preferences, intentions, actions), USE them to form a reasoned answer.
3. DO NOT default to "I don't have that recorded" if relevant facts exist — make a logical connection.
4. **ENTITY SPECIFICITY**: Prioritize identifying specific named entities or distinct categories mentioned in the retrieved context over generic descriptors.
5. Prefer a well-reasoned inference over stating uncertainty.
6. **TARGET-DEPENDENT ADAPTATION**: Adjust your reasoning strictness based on the nature of the question:
   - **For Named Entities** (Specific items, locations, names): Apply STRICT PRECISION. Prioritize explicit text references found in the context over general associations. Do not replace a specific, less common entity mentioned in text with a generic or popular alternative. **However**, EXCEPTION!!! - if no exact match exists, use the CLOSEST semantically related match from the context rather than stating information is missing — terminology may vary across different mentions of the same underlying entity or event. In such case, respond with "Based on my notes, it was likely [answer based on the closest related mention of that event or entity]
   - **For States & Patterns** (Lifestyle, relationships, habits, recurring choices): Apply INFERENTIAL SUFFICIENCY. Accept strong indirect evidence (visual clues, repeated actions) as valid proof. Do not require an explicit declarative sentence to confirm a clear behavioral pattern.
7. **NARRATIVE DEPTH**: For questions regarding consistent states, long-term paths, or persistent choices:
   - Prioritize consistent themes that appear across multiple segments of history.
   - A recurring theme or stated long-term state carries more weight than an isolated mention.
   - Consider the depth and duration of evidence across the timeline.
8. **EVENT LIFECYCLE**: When a question implies a completed outcome:
   - Trace the event through its stages in the context: intent, planning, preparation, execution, completion.
   - If the question asks when something "happened" or was "finalized", prioritize the completion or outcome mention over earlier stages.
   - Recognize that the same event may be referenced with different terminology at different stages.
   - If no exact terminology match exists, trace the closest semantic match — people often use interchangeable or related terms when referring to the same underlying event.
   - Do NOT state that information is missing if a close semantic match exists. Use the available match to form your answer.

**This mode exists because the question asks about relationships or requires reasoning across facts.**
` : ''}

${debugMode ? `
# DEBUG REASONING MODE
You must structure your response in two parts:
[REASONING]:
- Analyze the retrieved context.
- Explicitly state if any data was found.
- If suggesting "I don't know", explain EXACTLY why the context is insufficient.
- Check if names match.
- **RULE CITATION**: Explicitly mention which protocols or rules (e.g. TERMINOLOGY FLEXIBILITY, EVENT LIFECYCLE, TARGET-DEPENDENT ADAPTATION) you successfully applied or which ones failed to apply and why.
[ANSWER]:
- Your final, natural response to the user.
` : ''}

---

## CORE_MEMORY
${context.coreMemory || 'No core memory yet.'}

---

## RETRIEVED_CONTEXT
${context.countingResult ? `### RECALLED MEMORY (VERIFIED)
- **Search term**: "${context.countingResult.searchTerm}"
- **Total matches**: ${context.countingResult.count}
**Analysis/Enumeration**:
${context.countingResult.items.map((item: any) => typeof item === 'string' ? `  - ${item}` : `  - ${item.name}: ${item.summary}`).join('\n')}
` : ''}
${context.facts.length > 0 ? `### Relevant Facts\n${context.facts.map((f: string) => `- ${f}`).join('\n')}` : ''}
${context.entities.length > 0 ? `### Known Entities\n${context.entities.map((e: any) => `- **${e.name}** (${e.type}): ${e.description || 'No description'}`).join('\n')}` : ''}
${context.messages.length > 0 ? `### Retrieved Messages (Exact Wording)\n${context.messages.map((m: any) => `- [${formatTime(m.created_at)}] ${m.role}: \"${m.content}\"`).join('\n')}` : ''}
${context.documents && context.documents.length > 0 ? `### User's Documents\n${context.documents.map((d: any) => `**${d.title}**:\n${d.content}`).join('\n\n')}` : ''}
${context.timeline && context.timeline.length > 0 ? `### Timeline\n${context.timeline.join('\n')}` : ''}

---

Query depth: ${context.depth}
`;
}

export async function generateAnswer(question: string, simulatedDate: string, threadId: string, userId: string, debugMode: boolean = false): Promise<{ answer: string; context: any; reasoning?: string }> {
    const context = await brain.retrieveContext(threadId, question, [], userId);
    const augmentedPrompt = buildAugmentedPrompt(context, simulatedDate, debugMode);
    const response = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        reasoning_effort: 'medium',
        messages: [
            { role: 'system', content: augmentedPrompt },
            { role: 'user', content: question }
        ]
    });

    const fullContent = response.choices[0]?.message?.content || 'I don\'t know';
    let answer = fullContent;
    let reasoning = undefined;

    if (debugMode) {
        const reasoningMatch = fullContent.match(/\[REASONING\]:([\s\S]*?)\[ANSWER\]:/);
        const answerMatch = fullContent.match(/\[ANSWER\]:([\s\S]*)/);

        if (reasoningMatch) {
            reasoning = reasoningMatch[1].trim();
        }
        if (answerMatch) {
            answer = answerMatch[1].trim();
        } else if (fullContent.includes('[REASONING]')) {
            answer = fullContent.split('[ANSWER]:').pop()?.trim() || fullContent;
        }

        console.log('\n--- DEBUG REASONING ---\n', reasoning || 'No reasoning block found', '\n-----------------------\n');
    }

    return {
        answer,
        context,
        reasoning
    };
}

export async function computeSemanticMatch(question: string, prediction: string, groundTruth: string): Promise<{ passed: boolean; reasoning: string }> {
    const response = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
            {
                role: 'system',
                content: `Your task is to label an answer to a question as 'CORRECT' or 'WRONG'.

You will be given the following data:
(1) a question (posed by one user to another user)
(2) a 'gold' (ground truth) answer
(3) a generated answer which you will score as CORRECT/WRONG

The point of the question is to ask about something one user should know about the other user based on their prior conversations.

The gold answer will usually be a concise and short answer that includes the referenced topic, for example:
Question: Do you remember what I got the last time I went to Hawaii?
Gold answer: A shell necklace

The generated answer might be much longer, but you should be GENEROUS with your grading - as long as it touches on the same topic as the gold answer, it should be counted as CORRECT.

For time related questions, the gold answer will be a specific date, month, year, etc. The generated answer might be much longer or use relative time references (like "last Tuesday" or "next month"), but you should be generous with your grading - as long as it refers to the same date or time period as the gold answer, it should be counted as CORRECT. Even if the format differs (e.g., "May 7th" vs "7 May"), consider it CORRECT if it's the same date.

Respond with only "CORRECT" or "WRONG".`
            },
            {
                role: 'user',
                content: `Question: ${question}\nGold answer: ${groundTruth}\nGenerated answer: ${prediction}`
            }
        ]
    });

    const result = response.choices[0]?.message?.content?.trim().toUpperCase() || '';
    return {
        passed: result.includes('CORRECT'),
        reasoning: result
    };
}
