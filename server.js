import express from "express";
import { execFile } from "child_process";
import { createReadStream, statSync, unlinkSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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

// POST /extract — download audio from YouTube URL, upload to Supabase, return path
app.post("/extract", async (req, res) => {
  const { url, project_id } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }
  if (!project_id) {
    return res.status(400).json({ error: "project_id is required" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
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
    // Get video title
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

    // Download audio as m4a
    await new Promise((resolve, reject) => {
      execFile(
        "yt-dlp",
        [
          "-x",
          "--audio-format", "m4a",
          "--audio-quality", "0",
          "-o", outPath,
          "--no-warnings",
          "--no-playlist",
          url,
        ],
        { timeout: 300000 },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    const safeTitle = String(title)
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .substring(0, 80)
      .trim();

    const fileName = `${safeTitle || id}.m4a`;
    const storagePath = `${project_id}/${Date.now()}-${fileName}`;
    const audioBuffer = readFileSync(outPath);

    // Upload directly to Supabase Storage
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/audio/${storagePath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "audio/mp4",
          "x-upsert": "false",
        },
        body: audioBuffer,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Supabase upload failed: ${err}`);
    }

    res.json({
      storage_path: storagePath,
      file_name: fileName,
      file_size_bytes: audioBuffer.length,
      content_type: "audio/mp4",
      video_title: safeTitle || "Untitled",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    res.status(500).json({ error: message });
  } finally {
    try { unlinkSync(outPath); } catch {}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`yt-audio-service running on port ${PORT}`);
});
