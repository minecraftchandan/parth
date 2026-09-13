import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { MongoClient } from "mongodb";

const app = express();
const port = Number(process.env.PORT || 3001);
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE || "birthday_surprises";
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = fs.existsSync(path.join(projectRoot, "dist"))
  ? path.join(projectRoot, "dist")
  : projectRoot;

if (!mongoUri) {
  throw new Error("MONGODB_URI is required. Add it to a .env file before starting the API.");
}

const client = new MongoClient(mongoUri);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fieldSize: 2 * 1024 * 1024, files: 10, fileSize: 10 * 1024 * 1024 },
});

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function buildSurpriseData(fields, files) {
  const data = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeValue(value)]),
  );

  if (files.length) {
    data.uploadedPhotos = files.map((file) => ({
      name: file.originalname,
      type: file.mimetype,
      data: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    }));
  }

  return data;
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

async function sendOtpWebhook({ code, link, otp }) {
  const webhook = process.env.WEBHOOK;
  if (!webhook) throw new Error("WEBHOOK is required to deliver the unlock OTP.");

  const webhookUrl = new URL(webhook);
  webhookUrl.searchParams.set("wait", "true");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Birthday Link OTP",
      content: `Your OTP is **${otp}**.\nLink code: ${code}\nLink: ${link}`,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 200);
    throw new Error(`The unlock OTP could not be sent (webhook ${response.status}): ${details}`);
  }

  console.log(`Unlock OTP delivered through webhook for link ${code}.`);
}

async function surprisesCollection() {
  if (!client.topology?.isConnected()) await client.connect();
  return client.db(databaseName).collection("surprises");
}

app.post("/api/create", upload.any(), async (req, res, next) => {
  try {
    const code = crypto.randomBytes(6).toString("base64url");
    const otp = String(crypto.randomInt(100000, 1000000));
    const data = buildSurpriseData(req.body, req.files || []);
    const link = `${process.env.PUBLIC_URL || "http://localhost:5173"}/s/${code}`;
    const collection = await surprisesCollection();

    await collection.insertOne({
      code,
      data,
      otpHash: hashOtp(otp),
      createdAt: new Date(),
      visits: 0,
    });
    await sendOtpWebhook({ code, link, otp });
    res.status(201).json({ status: "success", code, shortCode: code, link, url: link, data });
  } catch (error) {
    next(error);
  }
});

app.post("/api/unlock", async (req, res, next) => {
  try {
    const code = String(req.body.code || "").trim();
    const otp = String(req.body.otp || "").trim();
    if (!code || !/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Enter the 6-digit OTP." });

    const collection = await surprisesCollection();
    const surprise = await collection.findOne({ code }, { projection: { _id: 0, otpHash: 1 } });
    if (!surprise || surprise.otpHash !== hashOtp(otp)) {
      return res.status(401).json({ error: "That OTP is not correct. Try again." });
    }

    const link = `${process.env.PUBLIC_URL || "http://localhost:5173"}/s/${code}`;
    res.json({ status: "success", link });
  } catch (error) {
    next(error);
  }
});

app.post("/api/create-order", (_req, res) => {
  res.json({ status: "success", order_id: crypto.randomUUID(), amount: 0, currency: "INR" });
});

app.get("/api/order-status", (_req, res) => {
  res.json({ status: "success", payment_status: "SUCCESS" });
});

async function getSurprise(req, res, next) {
  try {
    const collection = await surprisesCollection();
    const surprise = await collection.findOneAndUpdate(
      { code: req.params.code },
      { $inc: { visits: 1 } },
      { returnDocument: "after", projection: { _id: 0, data: 1, code: 1 } },
    );

    if (!surprise) return res.status(404).json({ error: "Surprise not found" });
    res.json({ status: "success", code: surprise.code, data: surprise.data, surprise: surprise.data });
  } catch (error) {
    next(error);
  }
}

app.get("/api/s/:code", getSurprise);
app.get("/api/view/:code", getSurprise);

app.post("/api/visit", async (req, res, next) => {
  try {
    const collection = await surprisesCollection();
    if (req.body.code) await collection.updateOne({ code: req.body.code }, { $inc: { visits: 1 } });
    res.json({ status: "success" });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(webRoot));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(webRoot, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const isMongoError = error?.name?.startsWith("Mongo") || error?.errorLabelSet;
  res.status(isMongoError ? 503 : 500).json({
    error: isMongoError
      ? "MongoDB is unavailable. Check Atlas Network Access and the MONGODB_URI, then retry."
      : error?.message || "The surprise could not be saved. Check the API and MongoDB configuration.",
  });
});

app.listen(port, () => {
  console.log(`Birthday API listening on http://localhost:${port}`);
});
