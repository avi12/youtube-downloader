#!/usr/bin/env node
/**
 * Native messaging host for YouTube Downloader.
 *
 * Chrome extensions can't make HTTP requests to googlevideo.com because Chrome
 * forces `Origin: chrome-extension://` which googlevideo rejects (403).
 * This host makes the requests natively with proper headers, bypassing CORS.
 *
 * Protocol: Chrome native messaging (4-byte length prefix + JSON on stdin/stdout).
 * Message limit: 1 MB per message (Chrome enforced). Large responses are chunked.
 *
 * Usage: Registered via native messaging manifest, launched automatically by Chrome.
 */

import { request as httpsRequest } from "node:https";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "native-host.log");
function debugLog(msg) {
  try { appendFileSync(LOG_PATH, `[${new Date().toISOString().substring(11,19)}] ${msg}\n`); } catch {}
}

const CHUNK_SIZE = 800_000; // ~800KB to stay under 1MB limit after base64 + JSON overhead

// ─── Chrome native messaging I/O ────────────────────────────────────────────

function readMessage() {
  return new Promise((resolve, reject) => {
    const lengthBuffer = Buffer.alloc(4);
    let bytesRead = 0;

    function readLength() {
      const chunk = process.stdin.read(4 - bytesRead);
      if (!chunk) {
        process.stdin.once("readable", readLength);
        return;
      }

      chunk.copy(lengthBuffer, bytesRead);
      bytesRead += chunk.length;

      if (bytesRead < 4) {
        process.stdin.once("readable", readLength);
        return;
      }

      const messageLength = lengthBuffer.readUInt32LE(0);
      if (messageLength === 0) {
        resolve(null);
        return;
      }

      readBody(messageLength);
    }

    function readBody(length) {
      const bodyBuffer = Buffer.alloc(length);
      let bodyBytesRead = 0;

      function readChunk() {
        const chunk = process.stdin.read(length - bodyBytesRead);
        if (!chunk) {
          process.stdin.once("readable", readChunk);
          return;
        }

        chunk.copy(bodyBuffer, bodyBytesRead);
        bodyBytesRead += chunk.length;

        if (bodyBytesRead < length) {
          process.stdin.once("readable", readChunk);
          return;
        }

        try {
          resolve(JSON.parse(bodyBuffer.toString("utf8")));
        } catch (error) {
          reject(new Error(`Invalid JSON: ${error.message}`));
        }
      }

      readChunk();
    }

    process.stdin.once("readable", readLength);
  });
}

function sendMessage(message) {
  const json = JSON.stringify(message);
  const buffer = Buffer.from(json, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}

// ─── HTTP request handler ───────────────────────────────────────────────────

function makeRequest({ url, method, headers, bodyBase64 }) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method || "POST",
      headers: {
        "Content-Type": "application/x-protobuf",
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Accept": "application/vnd.yt-ump",
        ...headers
      }
    };

    const req = httpsRequest(options, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(60_000, () => {
      req.destroy(new Error("Request timeout"));
    });

    if (bodyBase64) {
      req.write(Buffer.from(bodyBase64, "base64"));
    }

    req.end();
  });
}

// ─── Main loop ──────────────────────────────────────────────────────────────

async function main() {
  // Keep reading messages until stdin closes
  while (true) {
    const message = await readMessage();
    if (!message) {
      break;
    }

    const { requestId, type } = message;

    try {
      if (type === "fetch") {
        const { url, method, headers, bodyBase64, cookies } = message;

        const requestHeaders = { ...headers };
        if (cookies) {
          requestHeaders["Cookie"] = cookies;
        }

        debugLog(`fetch ${url.substring(0, 60)}... cookies=${cookies ? cookies.length + ' chars' : 'NONE'} body=${bodyBase64?.length || 0}b64`);

        const response = await makeRequest({
          url,
          method,
          headers: requestHeaders,
          bodyBase64
        });

        debugLog(`response status=${response.status} size=${response.body.length}`);
        const responseBase64 = response.body.toString("base64");

        // Chunk large responses to stay under Chrome's 1MB message limit
        if (responseBase64.length > CHUNK_SIZE) {
          const totalChunks = Math.ceil(responseBase64.length / CHUNK_SIZE);
          for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
            const start = iChunk * CHUNK_SIZE;
            const chunkData = responseBase64.slice(start, start + CHUNK_SIZE);
            sendMessage({
              requestId,
              type: "chunk",
              iChunk,
              totalChunks,
              status: response.status,
              chunkBase64: chunkData
            });
          }
        } else {
          sendMessage({
            requestId,
            type: "response",
            status: response.status,
            bodyBase64: responseBase64
          });
        }
      } else if (type === "ping") {
        sendMessage({ requestId, type: "pong" });
      }
    } catch (error) {
      sendMessage({
        requestId,
        type: "error",
        error: error.message
      });
    }
  }
}

main().catch(() => {
  process.exit(1);
});
