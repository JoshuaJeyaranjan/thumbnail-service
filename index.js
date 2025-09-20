import express from "express";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import cors from "cors";

const app = express();
app.use(express.json());

// CORS config - allow Authorization header (used by your client)
const corsOptions = {
  origin: process.env.ALLOWED_ORIGIN || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  exposedHeaders: ["Content-Length", "X-Request-Id"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

const supabaseUrl = process.env.PROJECT_URL;
const supabaseKey = process.env.SERVICE_ROLE_KEY;
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
    if (!bucket || !file) return res.status(400).json({ error: "Missing bucket/file" });

    const normalizedPath = file.replace(/^\/+/, "");
    const { data, error } = await supabase.storage.from(bucket).download(normalizedPath);
    if (error || !data) throw error;

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
          const uploadRes = await supabase.storage.from(DERIVED_BUCKET).upload(uploadPath, resizedBuffer, {
            contentType: `image/${fmt.ext}`,
            upsert: true,
          });

          if (uploadRes.error) throw uploadRes.error;
          generatedPaths[size.name][fmt.ext] = uploadPath;
        } catch (err) {
          console.error(`Failed to generate/upload ${size.name}/${fmt.ext} for ${file}:`, err);
          generatedPaths[size.name][fmt.ext] = null;
        }
      }
    }

    res.json({ ok: true, generatedPaths });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------- DELETE JOB ----------------
app.delete("/delete-job", async (req, res) => {
  try {
    const { job } = req.body;
    if (!job) return res.status(400).json({ ok: false, error: "Missing job data" });

    // 1️⃣ Delete derived images
    if (job.derived_paths) {
      for (const size in job.derived_paths) {
        for (const fmt in job.derived_paths[size]) {
          const fullPath = job.derived_paths[size][fmt];
          if (fullPath) {
            const { error } = await supabase.storage.from(DERIVED_BUCKET).remove([fullPath]);
            if (error) console.warn(`[DELETE] Failed to remove derived ${fullPath}:`, error);
          }
        }
      }
    }

    // 2️⃣ Delete original image
    if (job.path) {
      const { error } = await supabase.storage.from(ORIGINAL_BUCKET).remove([job.path]);
      if (error) console.warn(`[DELETE] Failed to remove original ${job.path}:`, error);
    }

    // 3️⃣ Delete DB row
    if (job.id) {
      const { error } = await supabase.from("images").delete().eq("id", job.id);
      if (error) console.warn("[DELETE] Failed to remove DB row:", error);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE] Error deleting job:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Thumbnail service running on port ${PORT}`));