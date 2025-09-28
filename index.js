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

app.use(cors(corsOptions));

const supabaseUrl = process.env.PROJECT_URL;
const supabaseKey = process.env.SERVICE_ROLE_KEY;

console.log("[SERVER] Supabase URL:", supabaseUrl ? supabaseUrl : "MISSING");
console.log("[SERVER] Supabase Key:", supabaseKey ? "SET" : "MISSING");

// Define both normal and admin clients
const supabase = createClient(supabaseUrl, supabaseKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseKey); // service role client

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
          const uploadRes = await supabaseAdmin.storage.from(DERIVED_BUCKET).upload(uploadPath, resizedBuffer, {
            contentType: `image/${fmt.ext}`,
            upsert: true,
          });

          if (uploadRes.error) throw uploadRes.error;
          generatedPaths[size.name][fmt.ext] = uploadPath;
        } catch (err) {
          console.error(`[THUMBNAILS] Failed ${size.name}/${fmt.ext}:`, err);
          generatedPaths[size.name][fmt.ext] = null;
        }
      }
    }

    res.json({ ok: true, generatedPaths });
  } catch (err) {
    console.error("[THUMBNAILS] Error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Unknown error" });
  }
});

// ---------------- RECORD UPLOAD ----------------
app.post("/record-upload", async (req, res) => {
  try {
    const { path, title, category } = req.body;
    if (!path || !title) {
      return res.status(400).json({ ok: false, error: "Missing path or title" });
    }

    const dbPayload = {
      title,
      category,
      bucket: ORIGINAL_BUCKET,
      path,
      uploaded_by: null, // or you can accept a user id if you want
      derived_paths: {},
    };

    // Check if it already exists
    const { data: existing, error: selectErr } = await supabaseAdmin
      .from("images")
      .select("id")
      .eq("path", path)
      .maybeSingle();

    if (selectErr) throw selectErr;

    if (!existing) {
      const { error: insertErr } = await supabaseAdmin.from("images").insert([dbPayload]);
      if (insertErr) throw insertErr;
      console.log(`[RECORD UPLOAD] Inserted new record for ${path}`);
    } else {
      const { error: updateErr } = await supabaseAdmin.from("images").update(dbPayload).eq("id", existing.id);
      if (updateErr) throw updateErr;
      console.log(`[RECORD UPLOAD] Updated existing record for ${path}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[RECORD UPLOAD] Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------- GENERATE UPLOAD URL ----------------
app.post("/generate-upload-url", async (req, res) => {
  const { fileName } = req.body;

  try {
    const { data, error } = await supabase.storage
      .from("photos-original")
      .createSignedUploadUrl(fileName, 60); // 60s validity

    if (error) throw error;

    res.json({ path: fileName, signedUrl: data.signedUrl, token: data.token });
  } catch (err) {
    console.error("[SERVER] generate-upload-url error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- DELETE JOB ----------------
app.post("/delete-job", async (req, res) => {
  try {
    const { path, derived_paths } = req.body;
    if (!path) return res.status(400).json({ ok: false, error: "Missing original path" });

    // Delete original file
    const { error: origErr } = await supabaseAdmin.storage.from(ORIGINAL_BUCKET).remove([path]);
    if (origErr) console.error("[DELETE JOB] Failed to delete original:", origErr);

    // Delete derived files
    if (derived_paths) {
      for (const size in derived_paths) {
        for (const fmt in derived_paths[size]) {
          const fullPath = derived_paths[size][fmt];
          if (!fullPath) continue;
          const { error: derivedErr } = await supabaseAdmin.storage.from(DERIVED_BUCKET).remove([fullPath]);
          if (derivedErr) console.error(`[DELETE JOB] Failed to delete derived ${fullPath}:`, derivedErr);
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE JOB] Error:", err);
    res.status(500).json({ ok: false, error: err?.message || "Unknown error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SERVER] Running on port ${PORT}`));