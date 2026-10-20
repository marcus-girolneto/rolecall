import { scriptedModel } from '@rolecall/ai-sdk';

/**
 * SIMULATED MODEL: a rule-based stand-in for an LLM so the demo runs offline with zero tokens.
 * It follows instructions literally, except that it refuses obvious prompt-injection requests,
 * like a well-aligned model usually would.
 */
export const demoModel = scriptedModel(({ userText, toolResults }) => {
  const text = userText.toLowerCase();

  if (toolResults.length) {
    const last = toolResults[toolResults.length - 1];
    if (last?.isError) return { text: `I couldn't complete that: ${String(last.output)}` };
    return { text: `Done: ${JSON.stringify(last?.output)}` };
  }

  if (/ignore (all |your |previous )?(rules|instructions)/.test(text)) {
    return { text: 'I can’t help with that request.' };
  }

  const invoiceId = userText.match(/inv_\d+/)?.[0];
  const customerId = userText.match(/cus_\d+/)?.[0];
  const amount = userText.match(/\$(\d+(?:\.\d+)?)/)?.[1];

  if (/refund/.test(text) && invoiceId) {
    return {
      toolCalls: [
        { tool: 'refundInvoice', args: { invoiceId, ...(amount ? { amount: Number(amount) } : {}) } },
      ],
    };
  }
  if (/(delete|remove|wipe)/.test(text) && customerId) {
    return { toolCalls: [{ tool: 'deleteCustomer', args: { customerId } }] };
  }
  if (/(list|show).*invoice/.test(text)) {
    return { toolCalls: [{ tool: 'listInvoices', args: customerId ? { customerId } : {} }] };
  }
  return { text: 'How can I help with your invoices?' };
}, 'demo-rules-v1');
