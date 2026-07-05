/**
 * Self-contained fakes for every external service the app talks to during
 * e2e runs: an Atlas/OpenAI-compatible chat completions API, the GitHub REST
 * API, an S3-compatible object store, and the Upstash Redis REST API.
 *
 * Started by playwright.config.ts; health endpoint: GET :4801/health
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../shared/fixtures",
);

const FIXTURE_GRAPH = readFileSync(
  join(fixturesDir, "diagram-graph.json"),
  "utf-8",
);
const FIXTURE_TREE = readFileSync(join(fixturesDir, "file-tree.txt"), "utf-8")
  .trim()
  .split("\n");

const AI_PORT = 4801;
const GITHUB_PORT = 4802;
const S3_PORT = 4803;
const REDIS_PORT = 4804;

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Fake Atlas/OpenAI chat completions
// ---------------------------------------------------------------------------

const EXPLANATION_TEXT = `<explanation>
This repository is a small demo application. The frontend is a Next.js app
that renders interactive diagrams, and the backend is a FastAPI service that
generates them and stores artifacts in object storage.
</explanation>`;

const USAGE = { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 };

const aiServer = createServer(async (request, response) => {
  if (request.url === "/health") {
    return sendJson(response, { ok: true });
  }

  if (request.method === "POST" && request.url?.includes("/chat/completions")) {
    const body = JSON.parse(await readBody(request));

    if (body.stream) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const words = EXPLANATION_TEXT.split(/(?<= )/);
      for (const word of words) {
        response.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: word } }],
          })}\n\n`,
        );
      }
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: USAGE })}\n\n`,
      );
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }

    // Structured graph request: return the shared fixture graph as JSON text.
    return sendJson(response, {
      id: "chatcmpl-mock",
      choices: [
        {
          message: { role: "assistant", content: FIXTURE_GRAPH },
          finish_reason: "stop",
        },
      ],
      usage: USAGE,
    });
  }

  sendJson(response, { error: `unmocked AI endpoint: ${request.url}` }, 404);
});

// ---------------------------------------------------------------------------
// Fake GitHub API
// ---------------------------------------------------------------------------

const githubServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path === "/repos/acme/demo") {
    return sendJson(response, {
      default_branch: "main",
      private: false,
      stargazers_count: 42,
    });
  }
  if (path.startsWith("/repos/acme/demo/commits/")) {
    return sendJson(response, { sha: "abc1234def5678900000000000000000000000ff" });
  }
  if (path.startsWith("/repos/acme/demo/git/trees/")) {
    return sendJson(response, {
      truncated: false,
      tree: FIXTURE_TREE.map((treePath) => ({ path: treePath })),
    });
  }
  if (path.startsWith("/repos/acme/demo/readme")) {
    return sendJson(response, {
      content: Buffer.from("# Demo\n\nA demo repository for e2e tests.").toString(
        "base64",
      ),
      encoding: "base64",
      size: 40,
    });
  }
  if (path.startsWith("/repos/acme/demo/compare/")) {
    return sendJson(response, { ahead_by: 0, status: "identical" });
  }

  sendJson(response, { message: "Not Found" }, 404);
});

// ---------------------------------------------------------------------------
// Fake S3 (path-style): /bucket/key…
// ---------------------------------------------------------------------------

const objects = new Map();

const s3Server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const key = decodeURIComponent(url.pathname.slice(1));

  if (request.method === "PUT") {
    objects.set(key, await readBody(request));
    response.writeHead(200, { ETag: '"mock"' });
    response.end();
    return;
  }
  if (request.method === "GET") {
    const value = objects.get(key);
    if (value === undefined) {
      response.writeHead(404, { "Content-Type": "application/xml" });
      response.end(
        '<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>No such key</Message></Error>',
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(value);
    return;
  }
  if (request.method === "HEAD") {
    response.writeHead(objects.has(key) ? 200 : 404);
    response.end();
    return;
  }
  if (request.method === "DELETE") {
    objects.delete(key);
    response.writeHead(204);
    response.end();
    return;
  }

  response.writeHead(405);
  response.end();
});

// ---------------------------------------------------------------------------
// Fake Upstash Redis REST (single-command POST body: ["SET", key, value, …])
// ---------------------------------------------------------------------------

const redis = new Map();

const redisServer = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405);
    response.end();
    return;
  }

  let command;
  try {
    command = JSON.parse(await readBody(request));
  } catch {
    return sendJson(response, { error: "bad command" }, 400);
  }

  const [name, ...args] = command.map(String);
  switch ((name ?? "").toUpperCase()) {
    case "SET":
      redis.set(args[0], args[1]);
      return sendJson(response, { result: "OK" });
    case "GET":
      return sendJson(response, { result: redis.get(args[0]) ?? null });
    case "DEL":
      redis.delete(args[0]);
      return sendJson(response, { result: 1 });
    default:
      return sendJson(response, { error: `unmocked command ${name}` });
  }
});

aiServer.listen(AI_PORT);
githubServer.listen(GITHUB_PORT);
s3Server.listen(S3_PORT);
redisServer.listen(REDIS_PORT);

console.log(
  `mock services listening: ai=${AI_PORT} github=${GITHUB_PORT} s3=${S3_PORT} redis=${REDIS_PORT}`,
);
