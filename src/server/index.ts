import crypto from "node:crypto";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import qrcode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { createServer as createViteServer } from "vite";
import { normalizeAudio } from "./audio.js";
import { ensureCertificate } from "./cert.js";
import { readLocalConfig } from "./config.js";
import { getLanAddresses, getPrimaryLanAddress } from "./network.js";
import { audioOriginalDir, certPath } from "./paths.js";
import { generateProjectName } from "./project-namer.js";
import { IdeaStore } from "./storage.js";
import { transcribeAudio } from "./transcription.js";

interface AuthedRequest extends Request {
  sessionToken?: string;
}

const isProduction = process.env.NODE_ENV === "production" || process.argv.includes("--production");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let activeServer: https.Server | undefined;

async function main(): Promise<void> {
  const config = await readLocalConfig();
  const lanAddresses = getLanAddresses();
  const primaryAddress = getPrimaryLanAddress();
  const certificate = await ensureCertificate(lanAddresses);
  const sessionToken = crypto.randomBytes(24).toString("base64url");
  const store = new IdeaStore();
  await store.init();

  const app = express();
  const upload = multer({
    dest: audioOriginalDir,
    limits: { fileSize: 25 * 1024 * 1024 }
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/qr.svg", async (_request, response, next) => {
    try {
      const phoneUrl = buildPhoneUrl(primaryAddress, config.port, sessionToken);
      response.type("image/svg+xml").send(await qrcode.toString(phoneUrl, { type: "svg", margin: 1 }));
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", requireSession(sessionToken));

  app.get("/api/snapshot", async (_request, response, next) => {
    try {
      response.json(await store.snapshot());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", (_request, response) => {
    response.json({
      transcriptionModel: config.transcriptionModel,
      projectNameModel: config.projectNameModel,
      minRecordingMs: config.minRecordingMs
    });
  });

  app.get("/api/connect-info", (_request, response) => {
    const phoneUrl = buildPhoneUrl(primaryAddress, config.port, sessionToken);
    response.json({
      phoneUrl,
      qrPath: `/qr.svg?token=${sessionToken}`
    });
  });

  app.post("/api/projects", async (request, response, next) => {
    try {
      response.status(201).json(await store.createProject(request.body?.name));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/projects/:projectId", async (request, response, next) => {
    try {
      response.json(await store.renameProject(request.params.projectId, request.body?.name));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:projectId/auto-name", async (request, response, next) => {
    try {
      const projectId = request.params.projectId;
      const snapshot = await store.snapshot();
      const project = snapshot.projects.find((candidate) => candidate.id === projectId);
      if (!project) {
        response.status(404).json({ error: "Project not found" });
        return;
      }
      if (project.nameLocked) {
        response.json(project);
        return;
      }

      const { transcripts, thoughtKey } = await store.getReadyThoughtNamingInput(projectId);
      if (transcripts.length === 0) {
        response.json(project);
        return;
      }
      if (project.autoNameThoughtKey === thoughtKey) {
        response.json(project);
        return;
      }

      const name = await generateProjectName(transcripts, config.projectNameModel);
      response.json(await store.autoRenameProject(projectId, name, thoughtKey));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ideas/audio", upload.single("audio"), async (request, response, next) => {
    try {
      if (!request.file) {
        response.status(400).json({ error: "Missing audio upload." });
        return;
      }

      const projectId = stringBodyValue(request.body.projectId);
      if (!projectId) {
        response.status(400).json({ error: "Missing projectId." });
        return;
      }

      const idea = await store.createIdea({
        projectId,
        originalAudioPath: request.file.path,
        originalMimeType: request.file.mimetype || stringBodyValue(request.body.mimeType) || "application/octet-stream",
        durationMs: numberBodyValue(request.body.durationMs)
      });

      void transcribeIdea(store, idea.id, config.transcriptionModel);
      response.status(202).json(idea);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ideas/:ideaId/retry", async (request, response, next) => {
    try {
      const idea = await store.getIdea(request.params.ideaId);
      await store.updateIdea(idea.id, { status: "pending", error: undefined });
      void transcribeIdea(store, idea.id, config.transcriptionModel);
      response.status(202).json(await store.getIdea(idea.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/export", async (request, response, next) => {
    try {
      response.json(
        await store.exportIdeas({
          projectId: stringBodyValue(request.body?.projectId),
          includeExported: Boolean(request.body?.includeExported)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);

  if (isProduction) {
    const clientDir = path.resolve(__dirname, "../../client");
    app.use(express.static(clientDir));
    app.get("*", (_request, response) => {
      response.sendFile(path.join(clientDir, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  activeServer = https.createServer(certificate, app);
  activeServer.listen(config.port, "0.0.0.0", () => {
    const phoneUrl = buildPhoneUrl(primaryAddress, config.port, sessionToken);
    const reviewUrl = `https://localhost:${config.port}/?token=${sessionToken}#/review`;

    console.log("");
    console.log("Idea Collector is running.");
    console.log(`Phone URL:   ${phoneUrl}`);
    console.log(`Review URL:  ${reviewUrl}`);
    console.log(`Cert file:   ${certPath}`);
    console.log("");
    qrcodeTerminal.generate(phoneUrl, { small: true });
  });
}

async function transcribeIdea(store: IdeaStore, ideaId: string, model: string): Promise<void> {
  try {
    await store.setIdeaStatus(ideaId, "transcribing");
    const idea = await store.getIdea(ideaId);
    const normalizedAudioPath = await normalizeAudio(idea.originalAudioPath, idea.id);
    await store.updateIdea(idea.id, { normalizedAudioPath });
    const transcript = await transcribeAudio(normalizedAudioPath, model);
    await store.updateIdea(idea.id, {
      status: "ready",
      transcript,
      error: undefined
    });
  } catch (error) {
    await store.setIdeaStatus(ideaId, "failed", error instanceof Error ? error.message : String(error));
  }
}

function requireSession(expectedToken: string) {
  return (request: AuthedRequest, response: Response, next: NextFunction) => {
    const token =
      request.header("x-session-token") ??
      (typeof request.query.token === "string" ? request.query.token : undefined);

    if (token !== expectedToken) {
      response.status(401).json({ error: "Invalid or missing session token." });
      return;
    }

    request.sessionToken = token;
    next();
  };
}

function buildPhoneUrl(host: string, port: number, token: string): string {
  return `https://${host}:${port}/?token=${token}`;
}

function stringBodyValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberBodyValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(statusCode).json({ error: message });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
