export const tavilySearchSample = {
  query: "OpenAI API pricing",
  follow_up_questions: null,
  answer: null,
  images: [],
  results: [
    {
      url: "https://pricepertoken.com/pricing-page/provider/openai",
      title: "OpenAI API Pricing (Updated 2025)",
      content: "Provider pricing table and model list.",
      score: 0.8830044,
      raw_content: null,
    },
    {
      url: "https://openai.com/api/pricing/",
      title: "API Pricing - OpenAI",
      content: "Official OpenAI pricing page snippet.",
      score: 0.8706085,
      raw_content: null,
    },
  ],
  response_time: 0.91,
  request_id: "aa542b19-9230-45d5-9533-039ff992b2b9",
};

export const tavilyExtractSample = {
  results: [
    {
      url: "https://openai.com/api/pricing/",
      title: "API Pricing - OpenAI",
      raw_content:
        "Pricing | OpenAI ... GPT-5.4 ... Input: $2.50 / 1M tokens ... Web Search Tool Call ...",
      images: [],
    },
  ],
  failed_results: [],
  response_time: 0.16,
  request_id: "e67dc741-bcf0-42d5-930b-3cbaa3fc97ba",
};

export const tavilyMapSample = {
  base_url: "https://openai.com/api/",
  results: [
    "https://openai.com/api/pricing",
    "https://openai.com/sora",
    "https://platform.openai.com/docs/overview",
  ],
  response_time: 1.23,
  request_id: "3bf5d6e0-5ca3-49ce-817e-de7272da34ea",
};

export const tavilyResearchSample = {
  request_id: "research-sample",
  status: "completed",
  content:
    "Retrieval augmented generation combines retrieval with generation to ground responses in external content.",
  sources: [
    {
      url: "https://example.com/rag",
      title: "RAG overview",
      citation: "RAG overview",
    },
  ],
};

export const manusCreateTaskSample = {
  task_id: "task_123",
  task_title: "Research task",
  task_url: "https://manus.example/tasks/task_123",
  share_url: null,
};
