import express from "express";
import { execFile } from "child_process";
import { createReadStream, statSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY || "";

// Auth middleware
app.use((req, res, next) => {
  if (API_KEY && req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// POST /extract — download audio from YouTube URL, return as file
app.post("/extract", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  // Validate YouTube URL
  const ytRegex =
    /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]+/;
  if (!ytRegex.test(url)) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  const id = randomUUID();
  const outPath = join(tmpdir(), `${id}.m4a`);

  try {
    // Get video title first
    const title = await new Promise((resolve, reject) => {
      execFile(
        "yt-dlp",
        ["--get-title", "--no-warnings", url],
        { timeout: 30000 },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        }
      );
    });

    // Download audio only as m4a
    await new Promise((resolve, reject) => {
      execFile(
        "yt-dlp",
        [
          "-x",
          "--audio-format",
          "m4a",
          "--audio-quality",
          "0",
          "-o",
          outPath,
          "--no-warnings",
          "--no-playlist",
          url,
        ],
        { timeout: 300000 }, // 5 min max
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    const stat = statSync(outPath);

    // Set headers with title metadata
    const safeTitle = String(title)
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .substring(0, 80)
      .trim();

    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeTitle || id}.m4a"`
    );
    res.setHeader("X-Video-Title", safeTitle || "Untitled");

    const stream = createReadStream(outPath);
    stream.pipe(res);
    stream.on("end", () => {
      try {
        unlinkSync(outPath);
      } catch {}
    });
    stream.on("error", () => {
      try {
        unlinkSync(outPath);
      } catch {}
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream error" });
      }
    });
  } catch (err) {
    // Clean up temp file on error
    try {
      unlinkSync(outPath);
    } catch {}
    const message = err instanceof Error ? err.message : "Extraction failed";
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`yt-audio-service running on port ${PORT}`);
});
