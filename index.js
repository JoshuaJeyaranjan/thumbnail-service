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
    const { bucket, file } = req.body;
if (!bucket || !file) return res.status(400).json({ error: "Missing bucket/file" });
const path = file; // keep the rest of the code using `path`


    // Normalize path
    const normalizedPath = file.replace(/^\/+/, "");

    // Download original
    const { data, error } = await supabase.storage.from(bucket).download(normalizedPath);
    if (error || !data) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());

    // Generate thumbnail
    const thumb = await sharp(buffer).resize({ width: 360 }).toBuffer();

    // Upload thumbnail
    const thumbPath = `thumb/${normalizedPath}`;
    const uploadRes = await supabase.storage.from(DERIVED_BUCKET).upload(thumbPath, thumb, {
      contentType: "image/jpeg",
      upsert: true,
    });

    if (uploadRes.error) throw uploadRes.error;

    res.json({ ok: true, message: "Thumbnail created", path: thumbPath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Thumbnail service running on port ${PORT}`));
