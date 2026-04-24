import { SYSTEM_PROMPT } from './prompts.js';
import type { MemoryContext } from './brain.js';

function formatTime(ts: string): string {
    const date = new Date(ts);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

export function buildMiraPrompt(context: MemoryContext): string {
    return `${SYSTEM_PROMPT}

---

## CORE_MEMORY
${context.coreMemory || 'No core memory yet.'}

---

## RETRIEVED_CONTEXT
${context.countingResult ? `### Recalled Memory
- **Search term**: "${context.countingResult.searchTerm}"
- **Total matches**: ${context.countingResult.count}
${context.countingResult.items.length > 0 ? context.countingResult.items.map(item => `- ${item}`).join('\n') : ''}
` : ''}
${context.facts.length > 0 ? `### Relevant Facts\n${context.facts.map(fact => `- ${fact}`).join('\n')}` : ''}
${context.entities.length > 0 ? `### Known Entities\n${context.entities.map(entity => `- **${entity.name}** (${entity.type}): ${entity.description || 'No description'}`).join('\n')}` : ''}
${context.messages.length > 0 ? `### Retrieved Messages (Exact Wording)\n${context.messages.map(message => `- [${formatTime(message.created_at)}] ${message.role}: "${message.content}"`).join('\n')}` : ''}
${context.documents.length > 0 ? `### User Documents\n${context.documents.map(document => `**${document.title}**:\n${document.content}`).join('\n\n')}` : ''}
${context.timeline.length > 0 ? `### Timeline\n${context.timeline.join('\n')}` : ''}

---

Query depth: ${context.depth}
`;
}
