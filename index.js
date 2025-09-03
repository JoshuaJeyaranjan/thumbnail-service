// functions/generate-thumbnails-node/index.js
import express from "express";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const app = express();
app.use(express.json());

const supabaseUrl = process.env.PROJECT_URL;
const supabaseKey = process.env.SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const DERIVED_BUCKET = "photos-derived";

app.post("/generate-thumbnails", async (req, res) => {
  try {
    const { bucket, path } = req.body;
    if (!bucket || !path) return res.status(400).json({ error: "Missing bucket/path" });

    // Download original
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());

    // Generate thumbnail
    const thumb = await sharp(buffer).resize({ width: 360 }).toBuffer();

    // Upload thumbnail
    await supabase.storage.from(DERIVED_BUCKET).upload(`thumb/${path}`, thumb, {
      contentType: "image/jpeg",
      upsert: true,
    });

    res.json({ ok: true, message: "Thumbnail created" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Thumbnail service running on port ${PORT}`));
