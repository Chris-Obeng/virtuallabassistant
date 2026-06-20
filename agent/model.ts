import { ChatOpenAI } from "@langchain/openai";

// Previous Inception Labs model config kept for quick rollback.
export const model = new ChatOpenAI({
  model: "mercury-2",
  apiKey: process.env.INCEPTION_API_KEY,
  configuration: {
    baseURL: "https://api.inceptionlabs.ai/v1",
  },
  temperature: 0,
  maxTokens: 8192,
  modelKwargs: {
    reasoning_effort: "high",
  },
});

// export const model = new ChatOpenAI({
//   model: "MiniMax-M2.7",
//   apiKey: process.env.MINIMAX_API_KEY,
//   configuration: {
//     baseURL: "https://api.minimax.io/v1",
//   },
//   temperature: 0,
//   maxTokens: 8192,
// });

//export const model = new ChatOpenAI({
//   model: "gpt-5.4",
//   apiKey: process.env.OPENAI_API_KEY,
//   maxTokens: 64000,
//   reasoning: {
//     effort: "medium",
//     summary: "auto",
//   },
// });
