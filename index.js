import express from "express";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors({
    origin: 'http://localhost:5173', // your frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  }));
  

const supabaseUrl = process.env.PROJECT_URL;
const supabaseKey = process.env.SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const DERIVED_BUCKET = "photos-derived";

// Define multiple sizes
const SIZES = [
  { name: "small", width: 360 },
  { name: "medium", width: 800 },
  { name: "large", width: 1200 },
];

// Define formats to generate
const FORMATS = [
  { ext: "jpg", options: {} },
  { ext: "webp", options: { quality: 80 } },
  { ext: "avif", options: { quality: 50 } },
];

app.post("/generate-thumbnails", async (req, res) => {
  try {
    const { bucket, file } = req.body;
    if (!bucket || !file) return res.status(400).json({ error: "Missing bucket/file" });

    const normalizedPath = file.replace(/^\/+/, "");

    // Download original
    const { data, error } = await supabase.storage.from(bucket).download(normalizedPath);
    if (error || !data) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());

    const generatedPaths = [];

    // Loop through sizes
    for (const size of SIZES) {
      // Loop through formats
      for (const fmt of FORMATS) {
        const transformer = sharp(buffer).resize({ width: size.width });

        // Apply format
        let resizedBuffer;
        switch (fmt.ext) {
          case "webp":
            resizedBuffer = await transformer.webp(fmt.options).toBuffer();
            break;
          case "avif":
            resizedBuffer = await transformer.avif(fmt.options).toBuffer();
            break;
          default:
            resizedBuffer = await transformer.jpeg(fmt.options).toBuffer();
        }

        const uploadPath = `${size.name}/${normalizedPath.replace(/\.[^/.]+$/, "")}.${fmt.ext}`;

        const uploadRes = await supabase.storage.from(DERIVED_BUCKET).upload(uploadPath, resizedBuffer, {
          contentType:
            fmt.ext === "webp" ? "image/webp" : fmt.ext === "avif" ? "image/avif" : "image/jpeg",
          upsert: true,
        });

        if (uploadRes.error) {
          console.error(`Upload error for ${uploadPath}:`, uploadRes.error);
          continue; // continue with other sizes/formats even if one fails
        }

        generatedPaths.push(uploadPath);
        console.log(`Generated ${uploadPath}`);
      }
    }

    res.json({
      ok: true,
      message: "Thumbnails created in multiple sizes and formats",
      generated: generatedPaths,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Thumbnail service running on port ${PORT}`));
