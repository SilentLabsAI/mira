import { OpenAI } from 'openai';
import { brain } from '@silentlabs/mira-core/brain';
import { buildMiraPrompt } from '@silentlabs/mira-core/prompt';

const openai = new OpenAI();

type ChatMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string;
};

function getAuthenticatedUserId(): string {
    // Replace with your auth provider's user id.
    return '00000000-0000-0000-0000-000000000001';
}

export async function POST(req: Request): Promise<Response> {
    const { messages, threadId } = await req.json() as {
        messages: ChatMessage[];
        threadId: string;
    };

    const userId = getAuthenticatedUserId();
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage || lastMessage.role !== 'user') {
        return Response.json({ error: 'Last message must be from the user.' }, { status: 400 });
    }

    const context = await brain.retrieveContext(threadId, lastMessage.content, messages, userId);
    const systemPrompt = buildMiraPrompt(context);

    const response = await openai.chat.completions.create({
        model: process.env.CHAT_MODEL || 'gpt-5-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages
        ],
    });

    const assistantText = response.choices[0]?.message?.content || '';

    await brain.processTurn(threadId, lastMessage.content, assistantText, userId);

    return Response.json({ message: { role: 'assistant', content: assistantText } });
}
