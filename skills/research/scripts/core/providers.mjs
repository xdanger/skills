import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";
import { fail } from "./session_schema.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MANUS_SCRIPT = join(REPO_ROOT, "skills", "manus", "scripts", "manus_client.mjs");

function shellOut(command, args, timeoutMs = 180000) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function mcporterArg(key, value) {
  if (Array.isArray(value)) {
    return `${key}=${JSON.stringify(value)}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${key}:${value}`;
  }
  if (value === null) {
    return `${key}=null`;
  }
  return `${key}=${value}`;
}

function callMcporter(tool, args, timeoutMs = 180000) {
  const cliArgs = ["mcporter", "call", tool];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) {
      continue;
    }
    cliArgs.push(mcporterArg(key, value));
  }
  const output = shellOut("npx", cliArgs, timeoutMs);
  return JSON.parse(output);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`Invalid ${label} payload: expected object.`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`Invalid ${label} payload: expected array.`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string") {
    fail(`Invalid ${label}: expected string.`);
  }
}

function assertOptionalString(value, label) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    fail(`Invalid ${label}: expected string or null.`);
  }
}

function normalizeSearchResultItem(item) {
  assertObject(item, "Tavily search result");
  assertString(item.url, "Tavily search result.url");
  assertString(item.title, "Tavily search result.title");
  return {
    url: item.url,
    title: item.title,
    content: typeof item.content === "string" ? item.content : "",
    score: typeof item.score === "number" ? item.score : 0,
    raw_content: item.raw_content ?? null,
    published_date: typeof item.published_date === "string" ? item.published_date : null,
  };
}

export function validateTavilySearchResponse(payload) {
  assertObject(payload, "Tavily search");
  assertString(payload.query, "Tavily search.query");
  assertArray(payload.results, "Tavily search.results");
  return {
    query: payload.query,
    follow_up_questions: Array.isArray(payload.follow_up_questions)
      ? payload.follow_up_questions
      : null,
    answer:
      typeof payload.answer === "string" || payload.answer === null ? payload.answer : null,
    images: Array.isArray(payload.images) ? payload.images : [],
    results: payload.results.map(normalizeSearchResultItem),
    response_time: typeof payload.response_time === "number" ? payload.response_time : null,
    request_id: typeof payload.request_id === "string" ? payload.request_id : null,
  };
}

function normalizeExtractResultItem(item) {
  assertObject(item, "Tavily extract result");
  assertString(item.url, "Tavily extract result.url");
  return {
    url: item.url,
    title: typeof item.title === "string" ? item.title : item.url,
    raw_content: typeof item.raw_content === "string" ? item.raw_content : "",
    content: typeof item.content === "string" ? item.content : "",
    published_date: typeof item.published_date === "string" ? item.published_date : null,
    images: Array.isArray(item.images) ? item.images : [],
  };
}

export function validateTavilyExtractResponse(payload) {
  assertObject(payload, "Tavily extract");
  assertArray(payload.results, "Tavily extract.results");
  return {
    results: payload.results.map(normalizeExtractResultItem),
    failed_results: Array.isArray(payload.failed_results) ? payload.failed_results : [],
    response_time: typeof payload.response_time === "number" ? payload.response_time : null,
    request_id: typeof payload.request_id === "string" ? payload.request_id : null,
  };
}

export function validateTavilyMapResponse(payload) {
  assertObject(payload, "Tavily map");
  assertArray(payload.results, "Tavily map.results");
  return {
    base_url: typeof payload.base_url === "string" ? payload.base_url : "",
    results: payload.results.filter((item) => typeof item === "string"),
    response_time: typeof payload.response_time === "number" ? payload.response_time : null,
    request_id: typeof payload.request_id === "string" ? payload.request_id : null,
  };
}

export function validateTavilyCrawlResponse(payload) {
  assertObject(payload, "Tavily crawl");
  assertArray(payload.results, "Tavily crawl.results");
  return {
    base_url: typeof payload.base_url === "string" ? payload.base_url : "",
    results: payload.results.map((item) => ({
      url: typeof item.url === "string" ? item.url : "",
      title: typeof item.title === "string" ? item.title : (item.url ?? ""),
      raw_content: typeof item.raw_content === "string" ? item.raw_content : "",
    })),
    response_time: typeof payload.response_time === "number" ? payload.response_time : null,
    request_id: typeof payload.request_id === "string" ? payload.request_id : null,
  };
}

export function validateTavilyResearchResponse(payload) {
  assertObject(payload, "Tavily research");
  assertOptionalString(payload.content, "Tavily research.content");
  return {
    request_id: typeof payload.request_id === "string" ? payload.request_id : null,
    status: typeof payload.status === "string" ? payload.status : null,
    content: typeof payload.content === "string" ? payload.content : "",
    answer: typeof payload.answer === "string" ? payload.answer : null,
    sources: Array.isArray(payload.sources) ? payload.sources : [],
  };
}

export function validateManusCreateTaskResponse(payload) {
  assertObject(payload, "Manus create task");
  assertOptionalString(payload.task_id, "Manus create task.task_id");
  assertOptionalString(payload.task_url, "Manus create task.task_url");
  assertOptionalString(payload.task_title, "Manus create task.task_title");
  assertOptionalString(payload.share_url, "Manus create task.share_url");
  return {
    task_id: payload.task_id ?? null,
    task_title: payload.task_title ?? null,
    task_url: payload.task_url ?? null,
    share_url: payload.share_url ?? null,
  };
}

export function createDefaultAdapters() {
  return {
    runTavilySearch({ query, depth, domains, timeRange, country }) {
      return validateTavilySearchResponse(
        callMcporter("tavily.tavily_search", {
          query,
          search_depth: depth,
          max_results: 10,
          include_domains: domains.length > 0 ? domains : undefined,
          time_range: timeRange,
          country: country ?? undefined,
          include_raw_content: false,
        }),
      );
    },
    runTavilyExtract({ urls, query }) {
      return validateTavilyExtractResponse(
        callMcporter("tavily.tavily_extract", {
          urls,
          query,
          extract_depth: "advanced",
          format: "markdown",
        }),
      );
    },
    runTavilyMap({ url, instructions, depth }) {
      return validateTavilyMapResponse(
        callMcporter("tavily.tavily_map", {
          url,
          max_depth: depth === "deep" ? 2 : 1,
          max_breadth: depth === "deep" ? 30 : 15,
          limit: depth === "deep" ? 40 : 20,
          instructions,
        }),
      );
    },
    runTavilyCrawl({ url, instructions, depth, selectPaths }) {
      return validateTavilyCrawlResponse(
        callMcporter("tavily.tavily_crawl", {
          url,
          max_depth: depth === "deep" ? 2 : 1,
          max_breadth: depth === "deep" ? 25 : 10,
          limit: depth === "deep" ? 20 : 10,
          instructions,
          select_paths: selectPaths,
          format: "markdown",
        }),
      );
    },
    runTavilyResearch({ input, depth }) {
      return validateTavilyResearchResponse(
        callMcporter(
          "tavily.tavily_research",
          {
            input,
            model: depth === "quick" ? "mini" : depth === "deep" ? "pro" : "auto",
          },
          depth === "deep" ? 300000 : 180000,
        ),
      );
    },
    runManusTask({ prompt, profile, locale, interactiveMode, sessionId }) {
      const output = shellOut("node", [
        MANUS_SCRIPT,
        "create",
        "--prompt",
        prompt,
        "--mode",
        "agent",
        "--profile",
        profile,
        "--label",
        sessionId,
        ...(locale ? ["--locale", locale] : []),
        ...(interactiveMode ? ["--interactive"] : []),
      ]);
      return validateManusCreateTaskResponse(JSON.parse(output));
    },
  };
}
