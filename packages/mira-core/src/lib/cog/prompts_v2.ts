export const FACT_EXTRACTION_PROMPT_V2 = `
## INPUT

*Your inputs are User’s and Assistant’s messages - referred to as “Context Message(s)” or just “Message(s)”, and include the following information:*

- [CURRENT DATE] or just [DATE] in the Context Message - the date of the conversation.
- Text - this is the message that the user generates. The user might provide you with different types of INPUT, such as:
    - Message (direct communication with the User and Assistant - you will see the [USER] and [ASSISTANT] exchanges in separate messages.
    - Notes or a journal entry - user might mention they are Notes or Journal entries.
    - Meeting notes / transcripts - you will usually see the exchanges between multiple speakers.
    - Articles - long form articles, usually with a title and a clean structure.

---

## Output Classification (FACT vs Correction)

For each fact, classify it as FACT or CORRECTION

1. **FACT:** Ground-truth details, preferences, decisions, claims, statements, or events. 
2. **CORRECTION:** User correcting/clarifying something they said before.
3. **EXAMPLE of FACTS and CORRECTIONS:**
    - **Context Message 1:** [March 14, 2024] [USER] “You know, Alex started a new job at TechCorp today”
    - **FACT for Message 1:** [FACT] [March 14, 2024] [Alex] started a new job at [TechCorp]
    - **Context Message 2:** [March 14, 2024] [USER] Oh actually it’s called the CorpTech, not TechCorp
    - **CORRECTION for Message 2:** [March 14, 2025] [USER] clarified that [Alex]’s new job is at [CorpTech], not [TechCorp]

---

## Output Formats of facts and corrections

1. **[TYPE]** - either [FACT] or [CORRECTION]
2. **[DATE]** - the date of the fact or correction. Depending on the context, either the RESOLVED DATE (see the TEMPORAL RESOLUTION section) or the CURRENT DATE (if temporal references rules do not apply). All dates in brackets [ ] must be in Month DD, YYYY format. If TEMPORAL RESOLUTION rule suggests to use the YEAR ONLY format, output YYYY as date
3. **[ENTITY NAME]** - any Names, Locations, etc. (e.g., [USER], [MADISON], [CHICAGO])
4. **FACT / CORRECTION TEXT** - the text of the recorded fact
5. **[METADATA]** - applicable if TOPIC RESOLUTION, or TEMPORAL RESOLUTION rules have been applied.
6. **OUTPUT EXAMPLES:**
    - **1 - TOPIC RESOLUTION rule applied:**
    *In this example you see how the FACT for Message 2 inherits the topic of Message 1, even though Message 2 does not explicitly mention “Atlas” - IF the context suggests they are still referencing it.*
        - **Context Message 1:** [Jan 15, 2026] [USER] I’m working on my Atlas project.
        - **FACT for Message 1:** [FACT] [Jan 15, 2026] [USER] is working on their Atlas project.
        - **Context Message 2:** [Jan 15, 2026] [USER] So far, it’s going great.
        - **FACT for Message 2:** [FACT] [Jan 15, 2026] [USER] said “so far, it’s going great” [referring to their Atlas project]
    - **2 - TEMPORAL RESOLUTION (past date relative expression, day level) rule applied:**
    *In this example you see how FACT DATE transforms from CURRENT DATE into date in the past, based on the duration expression*
        - **Context Message:** [June 10, 2025] [USER] I got to Bangkok 3 days ago.
        - **FACT:** [FACT] [June 7, 2025] [USER] got to [Bangkok] [mentioned as “3 days ago” on June 10, 2025]
    - **3 - TEMPORAL RESOLUTION (DURATION) rule applied:**
        - **Context Message:** [Feb 28, 2024] [USER] I’ve had this new job at SkyTech for 2 years now.
        - **FACT:** [FACT] [2022] [USER] started working at [SkyTech] [mentioned as “I’ve had this job for 2 years” on Feb 28, 2024]

---

## MANDATORY RULES

### TOPIC RESOLUTION:

1. **EVERY message must be contextualized.** 
2. **REPLACE AMBIGUOUS WORDS WITH SPECIFIC [ENTITY] or TOPIC**
Use the "Conversation Context" to replace ambiguous words (it, that, the plan, the activity, the item, the event) with the **SPECIFIC name** of the subject discussed previously. 
3. **CONNECT THE GENERIC CLAIMS TO THE TOPIC**
Avoid generic descriptors or "disconnected" claims such as "[name] said 'okay'" - you must connect to WHAT exactly that "okay" refers to - include both the specific topic AND the reference to the previous message.
4. **PRESERVE EXACT DETAILS (MANDATORY):**
When the user mentions a specific name, title, number, or quote, include it VERBATIM. Do NOT generalize or paraphrase specific details.
5. **CONTEXTUAL SYNTHESIS (MANDATORY):**
EACH TURN AND MESSAGE has significant context, and even a short message might clarify the previous one or provide other kind of a critical detail. Always look at the previous messages in the current session to find out if there were key details before that CLARIFY what this message is about, OR if this message clarifies what the PREVIOUS one was about. Never allow specific modifiers or identifiers to be lost to generic summarization.

6. **TOPIC RESOLUTION EXAMPLES:**
    1. **1 - TOPIC RESOLUTION rule applied:**
    *In this example you see how the FACT for Message 2 inherits the topic of Message 1, even though Message 2 does not explicitly mention “Atlas” - IF the context suggests they are still referencing it.*
        - **Context Message 1:** [Jan 15, 2026] [USER] I’m working on my Atlas project.
        - **FACT for Message 1:** [FACT] [Jan 15, 2026] [USER] is working on their Atlas project.
        - **Context Message 2:** [Jan 15, 2026] [USER] So far, it’s going great.
        - **FACT for Message 2:** [FACT] [Jan 15, 2026] [USER] said “so far, it’s going great” [referring to their Atlas project]
    2. **2 - TOPIC RESOLUTION and TEMPORAL RESOLUTION rules applied:**
    *In this example you see how FACT for Message 1 applies the TEMPORAL RESOLUTION rule. The FACT for Message 2 inherits the topic of Message 1 (new workout program), but DOES NOT apply the TEMPORAL INHERITANCE rule since this is a real time observation.*
        - **Context Message 1:** [Dec 20, 2025] [USER] I tried a new workout yesterday. Check out my glutes!
        - **FACT for Message 1:** [FACT] [Dec 19, 2025] [USER] Tried a new workout [Mentioned as “yesterday” on Dec 20, 2025] *→* *temporal resolution rule applied*
        - **Context Message 2:** [Dec 20, 2025] [USER] They look pumped tbh, this was a great program!
        - **FACT for Message 2:** [FACT] [Dec 20, 2025] [USER] observed that the glutes look pumped and that the workout program was great [in relation to the workout program tried on Dec 19, 2025] *→ this is a real time observation, so TEMPORAL RESOLUTION rule is NOT applied. But the TOPIC RESOLUTION and CONTEXTUALIZATION rules are applied by adding the “in relation to” in the METADATA.*

### **TEMPORAL RESOLUTION (MANDATORY):**

*Guidance on [DATE] for the Fact / Correction output.*

1. **CALCULATE THE [DATE] FOR THE FACT/CORRECTION BASED ON THE CURRENT DATE AND RELATIVE EXPRESSION/DURATION (IF ANY). THE RELATIVE EXPRESSION/DURATION (IF ANY) MUST BE ADDED AS METADATA.**
2. **LITERAL CALENDAR DATE INTERPRETATION (STRICT):**
Interpret the [CURRENT DATE] provided in the system prompt LITERALLY. 00:00 (Midnight) on December 1 is December 1. Do not adjust for "late-night" or "emotional" context. Always calculate relative references (yesterday, last night, today) based strictly on that calendar date.

3. **IF THERE IS NO RELATIVE EXPRESSION OR DATE REFERENCES IN THE MESSAGE OR THE DATE MENTIONED IS TODAY:**
    1. Use the [DATE] provided in the CONTEXT for ALL facts where no other date OR relative expression is mentioned.
    2. **EXAMPLE 1 (NO RELATIVE EXPRESSION OR DATE REFERENCE IN THE MESSAGE. NO PREVIOUS CONTEXT IN THE CONVERSATION)**
        - **Context Message (NEW CONVERSATION):** [March 15, 2024] [USER] I’m so happy!
        - **FACT:** [FACT] [March 15, 2024] The [USER] is happy.
    3. **EXAMPLE 2 (NO RELATIVE EXPRESSION, NO DATE/THE DATE IS TODAY. TOPIC RESOLUTION rule applied):**
        - **Context Message 1:** [May 20, 2024] [USER] My product just went live, and I already got 200 users!
        - **Fact for Message 1:** [FACT] [May 20, 2024] [USER]’s product just went live, and it already got 200 users.
        - **Context Message 2:** [May 20, 2024] [USER] I’m so happy!
        - **Fact for Message 2:** [FACT] [May 20, 2024] [USER] is happy [in relation to their product launch that just went live]
        - **Context Message 3:** [May 20, 2025] [USER] Oh and also I’m organizing a party today to celebrate, there will be quite a lot of people.
        - **Fact for Message 3:** [May 20, 2025] [USER] is organizing a party to celebrate the product launch, there will be a lot of people.
4. **IF THERE ARE RELATIVE OR DURATION REFERENCES:**
    1. **For Day / Week / Specific Intervals (durations)**
    *Such as PAST: “yesterday”, “last week”, “5 days ago” "for 3 days", etc. | FUTURE: "tomorrow", "next week", "in 2 days", etc.):*
        - **CALCULATE THE EXACT DATE:** Subtract/add the time from [CURRENT DATE].
        - **Use that CALCULATED DATE as the [DATE] in brackets for the FACT**
        - **REPHRASE THE DURATION FOR THE FACT TEXT:**
         If a duration is used (e.g., "I’ve been sick for 3 days" or “I’ve had this phone for 3 years), rephrase to "started”/’did”/”began”/”got”/”purchased” and so on.
        - **METADATA:**
        ALWAYS add the RELATIVE or DURATION expression
            - For RELATIVE EXPRESSIONS ALWAYS "[mentioned as "[EXPRESSION]" on [CURRENT DATE]]"
            - For DURATION “[has had/has been for [DURATION] as of [CURRENT DATE]”
        - **EXAMPLE (Past relative expression):**
            - **Context Message:** [May 20, 2024] [USER] I went to the gym yesterday.
            - **FACT**: ****[FACT] [May 19, 2024] [USER] went to the gym [mentioned as "yesterday" on May 20, 2024]
        - **EXAMPLE (Future relative expression + TOPIC RESOLUTION / CONTEXTUALIZATION):**
            - **Context Message 1:** [May 22, 2024] [USER] Gosh, finally getting close to launch with Atlas.
            - **FACT for Message 1**: ****[FACT] [May 22, 2024] [USER] is finally getting close to launch with their project Atlas.
            - **Context Message 2:** [May 22, 2024] [USER] So, the soft launch is planned in two days.
            - **FACT for Message 2**: ****[FACT] [May 24, 2024] [USER]’s Atlas project soft launch [mentioned as "planned in two days" on May 22, 2024]
        - **EXAMPLE (Duration):**
            - **Context Message:** [Jan 10, 2024] [USER] I've been sick for 3 days
            - **FACT:** [Jan 7, 2024] [USER] became sick ["has been sick for 3 days" as of January 10, 2024]
    2. **Year/Multi-Month Intervals**
    *Such as PAST: "last year", "3 years ago", "for 2 years", "the past 6 months", etc.)*
        - **CALCULATE THE DATE**
            - **PAST - CALCULATE THE STARTING POINT:** Subtract the time from [CURRENT DATE] to find the year/month the action began.
            - FUTURE:  Add the time to [CURRENT DATE]
        - Use the **CALCULATED START YEAR or MONTH** as the [DATE] in brackets.
        - **MANDATORY TRANSFORMATION (STRICT): I**f a duration (e.g., "for 3 years") is used, you MUST rephrase the fact to describe the **START** (e.g., "started", "began", "obtained", "moved in") instead of the duration.
        - **METADATA:** ALWAYS end with "[mentioned as "[EXPRESSION]" on [CURRENT DATE]]".
        - **EXAMPLE 1:**
            - Context Message: [June 28, 2024] [USER] I moved into my apartment on Madison St a year ago.
            - FACT: [FACT] [2023] [USER] moved into their Madison St apartment [mentioned as "a year ago" on June 25, 2024]
        - **EXAMPLE - WITH TOPIC RESOLUTION and other context:**
            - Context Message 1: [Jan 20, 2021] [USER] This place is really great.
            - FACT for Message 1: [FACT] [Jan 20, 2021] [USER] observed that “this place” is really great.
            - Context Message 2: [Jan 20, 2021] [USER] Yeah, I’ve been here for 2 years now, since I’ve moved into.
            - FACT for Message 2: [FACT] [2019] [USER] has moved into “this place” [mentioned as “been here for 2 years” on Jan 20, 2021]
            - Context Message 3: [Jan 20, 2021] [USER]
            - FACT for Message 3: [FACT] [2019] [USER] has moved into “this place” [mentioned as “been here for 2 years” on Jan 20, 2021]
            - Context Message 4: [Jan 20, 2021] [USER]
            - FACT for Message 3: [FACT] [2019] [USER] has moved into “this place” [mentioned as “been here for 2 years” on Jan 20, 2021]
        - **THE DURATION TRAP (CRITICAL):**
        Do NOT anchor facts with durations (e.g., "for 5 years", "the past 6 months") to the [CURRENT DATE] - the START DATE must be calculated and used as [DATE] of the fact / correction:
            - Context Message: [Jan 10, 2022] [USER] I’ve lived in my Madison St apartment for 2 years now.
            - WRONG FACT: [FACT] [Jan 10, 2022] [USER] has lived in their Madison St apartment for 2 years.
            - CORRECT FACT: [2020] [User] started living here [mentioned as "for 2 years" on Jan 2022]

### TEMPORAL INHERITANCE (CRITICAL):

If a message relates to an event/plan that was given a resolved date earlier in the conversation, anchor that fact to the SAME resolved date. This applies to BOTH past and future references. The exception is real-time questions, or observations about the even such as “how was it?” “I love these types of events”, or “It was nice to see all friends together”

- **FUTURE example (Transcript):**
*A transcript example of a communication between 2 speakers*
    - Context Message 1: [March 14, 2024] [Speaker A] Let's meet tomorrow (talking to Speaker B)
    - FACT for Message 1: [FACT] [March 15, 2024] Speaker A meets with Speaker B (mentioned as “tomorrow” on March 14)
    - Context Message 2: [March 14, 2024] [Speaker B] Nice, I’ll bring the documents.
    - FACT for Message 2: [March 15, 2024] [Speaker B] Will bring the documents to the meeting with Speaker A [agreed to meet “Tomorrow” on March 14]
- **PAST example (Transcript), with an exception:**
*A transcript example of a communication between 2 speakers. Fact for Message 2 DOES NOT inherit the Resolved Date as it is a real time question / observation ABOUT the event*
    - Context Message 1: [March 14, 2024] [Speaker A] I went hiking yesterday.
    - FACT for Message 1: [FACT] [March 13, 2024] Speaker A went hiking [mentioned as “yesterday” on March 14]
    - Context Message 2: [March 14, 2024] [Speaker B] How was it?
    - FACT for Message 2: [March 14, 2024] [Speaker B] Asked [Speaker A] how was the hike [referring to the Speaker A’s hike on March 13]
    - Context Message 3: [March 14, 2024] [Speaker A] I saw a bear there!
    - FACT for Message 3: [March 13, 2024] [Speaker A] [Speaker A] saw a bear while hiking [mentioned as “Yesterday” on March 14];
`;
