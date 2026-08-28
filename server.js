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
const otpChallenges = new Map();
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

function createOtp() {
  return String(crypto.randomInt(1000, 10000));
}

app.post("/api/request-otp", async (_req, res, next) => {
  try {
    const otp = createOtp();
    const challengeId = crypto.randomBytes(16).toString("hex");
    otpChallenges.set(challengeId, { otp, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });

    const webhookResponse = await fetch(process.env.WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Birthday surprise link OTP: **${otp}** (expires in 10 minutes)`,
      }),
    });
    if (!webhookResponse.ok) throw new Error(`Discord webhook returned ${webhookResponse.status}`);

    res.json({ status: "success", challengeId });
  } catch (error) {
    next(error);
  }
});

async function surprisesCollection() {
  if (!client.topology?.isConnected()) await client.connect();
  return client.db(databaseName).collection("surprises");
}

app.post("/api/create", upload.any(), async (req, res, next) => {
  try {
    const challengeId = req.body.otpChallengeId || req.get("X-OTP-Challenge");
    const suppliedOtp = req.body.otp || req.get("X-OTP");
    const challenge = otpChallenges.get(challengeId);
    if (!challenge || challenge.expiresAt < Date.now() || challenge.attempts >= 5) {
      return res.status(401).json({ error: "Request a new OTP before creating the link." });
    }
    challenge.attempts += 1;
    if (suppliedOtp !== challenge.otp) {
      return res.status(401).json({ error: "The OTP is incorrect." });
    }
    otpChallenges.delete(challengeId);

    const code = crypto.randomBytes(6).toString("base64url");
    const data = buildSurpriseData(req.body, req.files || []);
    const collection = await surprisesCollection();

    await collection.insertOne({
      code,
      data,
      createdAt: new Date(),
      visits: 0,
    });

    const link = `${process.env.PUBLIC_URL || "http://localhost:5173"}/s/${code}`;
    res.status(201).json({ status: "success", code, shortCode: code, link, url: link, data });
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
  res.status(500).json({ error: "The surprise could not be saved. Check the API and MongoDB configuration." });
});

app.listen(port, () => {
  console.log(`Birthday API listening on http://localhost:${port}`);
});
