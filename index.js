import express from "express";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import cors from "cors";

const app = express();
app.use(express.json());

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://demetriose.netlify.app",
    "https://dfsvision.ca",
    "https://dfsvision.com",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  exposedHeaders: ["Content-Length", "X-Request-Id"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors());

const supabaseUrl = process.env.PROJECT_URL;
const supabaseKey = process.env.SERVICE_ROLE_KEY;
console.log("[SERVER] Supabase URL:", supabaseUrl ? supabaseUrl : "MISSING");
console.log("[SERVER] Supabase Key:", supabaseKey ? "SET" : "MISSING");

const supabase = createClient(supabaseUrl, supabaseKey);

const DERIVED_BUCKET = "photos-derived";
const ORIGINAL_BUCKET = "photos-original";

const SIZES = [
  { name: "small", width: 360 },
  { name: "medium", width: 800 },
  { name: "large", width: 1200 },
];
const FORMATS = [
  { ext: "webp", options: { quality: 80 } },
  { ext: "avif", options: { quality: 50 } },
];

// ---------------- THUMBNAIL GENERATION ----------------
app.post("/generate-thumbnails", async (req, res) => {
  try {
    const { bucket, file } = req.body;
    console.log("[THUMBNAILS] Request received:", { bucket, file });

    if (!bucket || !file) {
      console.warn("[THUMBNAILS] Missing bucket or file in request");
      return res.status(400).json({ error: "Missing bucket/file" });
    }

    const normalizedPath = file.replace(/^\/+/, "");
    console.log("[THUMBNAILS] Normalized path:", normalizedPath);

    const { data, error } = await supabase.storage.from(bucket).download(normalizedPath);
    if (error || !data) {
      console.error("[THUMBNAILS] Error downloading original:", error);
      throw error;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const generatedPaths = {};

    for (const size of SIZES) {
      generatedPaths[size.name] = {};
      for (const fmt of FORMATS) {
        try {
          const transformer = sharp(buffer).resize({ width: size.width });
          const resizedBuffer =
            fmt.ext === "webp"
              ? await transformer.webp(fmt.options).toBuffer()
              : await transformer.avif(fmt.options).toBuffer();

          const uploadPath = `${size.name}/${normalizedPath.replace(/\.[^/.]+$/, "")}.${fmt.ext}`;
          console.log(`[THUMBNAILS] Uploading ${uploadPath}`);
          const uploadRes = await supabase.storage.from(DERIVED_BUCKET).upload(uploadPath, resizedBuffer, {
            contentType: `image/${fmt.ext}`,
            upsert: true,
          });

          if (uploadRes.error) throw uploadRes.error;
          generatedPaths[size.name][fmt.ext] = uploadPath;
        } catch (err) {
          console.error(`[THUMBNAILS] Failed to generate/upload ${size.name}/${fmt.ext} for ${file}:`, err);
          generatedPaths[size.name][fmt.ext] = null;
        }
      }
    }

    console.log("[THUMBNAILS] Generated paths:", generatedPaths);
    res.json({ ok: true, generatedPaths });
  } catch (err) {
    console.error("[THUMBNAILS] Internal server error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Unknown error" });
  }
});

// UPLOAD URL
app.post("/generate-upload-url", async (req, res) => {
  const { fileName, fileType } = req.body;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from("photos-original")
      .createSignedUploadUrl(fileName, 60); // valid 60 seconds

    if (error) throw error;
    res.json({ uploadUrl: data.signedUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- DELETE JOB ----------------
app.post("/delete-job", async (req, res) => {
  try {
    const { path, derived_paths } = req.body;
    console.log("[DELETE JOB] Request received:", { path, derived_paths });

    if (!path) return res.status(400).json({ ok: false, error: "Missing original path" });

    // Delete original file
    const { error: origErr } = await supabase.storage.from(ORIGINAL_BUCKET).remove([path]);
    if (origErr) console.error("[DELETE JOB] Failed to delete original:", origErr);

    // Delete derived files
    if (derived_paths) {
      for (const size in derived_paths) {
        for (const fmt in derived_paths[size]) {
          const fullPath = derived_paths[size][fmt];
          if (!fullPath) continue;
          const { error: derivedErr } = await supabase.storage.from(DERIVED_BUCKET).remove([fullPath]);
          if (derivedErr) console.error(`[DELETE JOB] Failed to delete derived ${fullPath}:`, derivedErr);
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE JOB] Internal server error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Unknown error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SERVER] Thumbnail service running on port ${PORT}`));;