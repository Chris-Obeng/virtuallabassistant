import { request } from "http";
import { createMiddleware, ToolMessage } from "langchain";

let callCount = 0;
export const logToolCallMiddleware = createMiddleware({
  name: "logToolCall",
  wrapToolCall: async (request, handler) => {
    callCount++;
    const toolName = request.toolCall.name;
    console.log(
      `[middleware] Tool call #${callCount}: ${toolName} args: ${JSON.stringify(request.toolCall.args)}`,
    );
    const result = await handler(request);
    console.log(
      `[middleware] toolCall completed: ${toolName} count: #${callCount}`,
    );
    return result;
  },
});

const handleToolErrors = createMiddleware({
  name: "HandleToolErrors",
  wrapToolCall: async (request, handler) => {
    try {
      return await handler(request);
    } catch (error) {
      return new ToolMessage({
        content: `Tool error: Please check your input and try again. (${error})`,
        tool_call_id: request.toolCall.id!,
      });
    }
  },
});

export const agentMiddlewares = [logToolCallMiddleware, handleToolErrors];
