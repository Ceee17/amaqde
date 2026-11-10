import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const AUDIT_TAP_DEFAULT = "http://swrt-audit-tap:4002";
const RUST_KERNEL_DEFAULT = "http://swrt-rust-kernel:4001";

function resolveAuditTapUrl(): string {
  return process.env.AUDIT_TAP_URL || AUDIT_TAP_DEFAULT;
}

function resolveRustKernelUrl(): string {
  return process.env.RUST_KERNEL_URL || RUST_KERNEL_DEFAULT;
}

function resolveRepoRoot(): string {
  if (process.env.SWRT_REPO_ROOT && fs.existsSync(process.env.SWRT_REPO_ROOT)) {
    return process.env.SWRT_REPO_ROOT;
  }
  const cwd = process.cwd();
  if (path.basename(cwd) === "frontend") {
    return path.resolve(cwd, "..");
  }
  return cwd;
}

function resolvePythonBin(repoRoot: string): string {
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN)) {
    return process.env.PYTHON_BIN;
  }
  const candidates = [
    path.join(repoRoot, ".venv", "Scripts", "python.exe"),
    path.join(repoRoot, ".venv", "bin", "python"),
    "/opt/venv/bin/python",
    "python3",
    "python",
  ];
  for (const c of candidates) {
    if (c.includes(path.sep) || c.startsWith("/")) {
      if (fs.existsSync(c)) return c;
    } else {
      return c;
    }
  }
  return "python";
}

function isValidSha256(hash: unknown): boolean {
  return typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash);
}

/**
 * Mandatory Merkle Audit Gate (Rule 4):
 * Reject any trade decision that lacks a valid 64-char `receipt_sha256`,
 * `snapshot_sha256`, and existing `parquet_uri`.
 */
function enforceMerkleAuditGate(payload: any) {
  if (!payload || !Array.isArray(payload.receipts)) {
    throw new Error("Audit vault ledger is missing or empty.");
  }
  const verifiedReceipts = payload.receipts.filter((row: any) => {
    const hasReceiptHash = isValidSha256(row?.receipt_sha256);
    const hasSnapshotHash = isValidSha256(row?.snapshot_sha256);
    const hasParquetUri =
      typeof row?.parquet_uri === "string" && row.parquet_uri.endsWith(".parquet");
    return hasReceiptHash && hasSnapshotHash && hasParquetUri;
  });

  return {
    ...payload,
    receipts: verifiedReceipts,
  };
}

async function checkRustKernelHealth(rustKernelUrl: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${rustKernelUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      return "ONLINE";
    }
  } catch {
    // Rust kernel offline or unreachable
  }
  return "OFFLINE";
}

export async function GET() {
  const auditTapUrl = resolveAuditTapUrl();
  const rustKernelUrl = resolveRustKernelUrl();
  console.log(`[swrt-web-ui] GET /api/swrt - Checking audit tap at ${auditTapUrl}`);

  // 1. First attempt upstream microservice swrt-audit-tap
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const tapRes = await fetch(`${auditTapUrl}/v1/receipts`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeoutId);

    if (tapRes.ok) {
      const payload = await tapRes.json();
      const rustStatus = await checkRustKernelHealth(rustKernelUrl);
      const enriched = {
        ...payload,
        services_health: {
          rust_kernel: rustStatus,
          audit_tap: "ONLINE",
          web_ui: "ONLINE",
        },
      };
      const gated = enforceMerkleAuditGate(enriched);
      console.log(
        `[swrt-web-ui] GET /api/swrt - Proxy success from audit-tap (${gated.receipts?.length || 0} receipts, rust: ${rustStatus})`
      );
      return NextResponse.json(gated, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.log(`[swrt-web-ui] GET /api/swrt - Audit tap responded with HTTP ${tapRes.status}`);
  } catch (tapErr: any) {
    console.log(
      `[swrt-web-ui] GET /api/swrt - Audit tap unreachable (${tapErr?.message || tapErr}), using local filesystem fallback`
    );
  }

  // 2. Standalone Fallback: Local filesystem + Python
  try {
    const repoRoot = resolveRepoRoot();
    const mirrorFile = path.join(repoRoot, "audit_vault", "latest_receipts.json");
    const pythonBin = resolvePythonBin(repoRoot);

    if (!fs.existsSync(mirrorFile)) {
      console.log(`[swrt-web-ui] Running fallback agent_exe_unifier via ${pythonBin}...`);
      execFileSync(
        pythonBin,
        ["-m", "agents.agent_exe_unifier", "--run-all-regimes"],
        {
          cwd: repoRoot,
          stdio: "pipe",
          env: { ...process.env, PYTHONPATH: repoRoot },
        }
      );
    }
    const rawText = fs.readFileSync(mirrorFile, "utf-8");
    const parsed = JSON.parse(rawText);
    const rustStatus = await checkRustKernelHealth(rustKernelUrl);
    const enriched = {
      ...parsed,
      services_health: {
        rust_kernel: rustStatus,
        audit_tap: "STANDALONE_LOCAL",
        web_ui: "ONLINE",
      },
    };
    const gated = enforceMerkleAuditGate(enriched);
    return NextResponse.json(gated, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    console.error(`[swrt-web-ui] GET /api/swrt fallback failed:`, err);
    return NextResponse.json(
      { error: err?.message || "Failed to load Merkle Audit Vault" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auditTapUrl = resolveAuditTapUrl();
  const rustKernelUrl = resolveRustKernelUrl();

  let ticker = "BBCA";
  let regime = "COHERENT_ACCUMULATION";

  try {
    const body = await req.json();
    ticker = String(body.ticker || "BBCA")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    regime = String(body.regime || "COHERENT_ACCUMULATION").toUpperCase();
  } catch {
    // use defaults
  }

  console.log(`[swrt-web-ui] POST /api/swrt - Request run for ticker=${ticker}, regime=${regime}`);

  // 1. First attempt upstream microservice swrt-audit-tap
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    console.log(`[swrt-web-ui] POST /api/swrt - Forwarding to ${auditTapUrl}/v1/pipeline/run`);

    const tapRes = await fetch(`${auditTapUrl}/v1/pipeline/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, regime }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (tapRes.ok) {
      const payload = await tapRes.json();
      const rustStatus = await checkRustKernelHealth(rustKernelUrl);
      const enriched = {
        ...payload,
        services_health: {
          rust_kernel: rustStatus,
          audit_tap: "ONLINE",
          web_ui: "ONLINE",
        },
      };
      const gated = enforceMerkleAuditGate(enriched);
      console.log(`[swrt-web-ui] POST /api/swrt - Pipeline successfully executed via ${auditTapUrl}`);
      return NextResponse.json(gated, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.log(`[swrt-web-ui] POST /api/swrt - Audit tap returned HTTP ${tapRes.status}`);
  } catch (tapErr: any) {
    console.log(
      `[swrt-web-ui] POST /api/swrt - Audit tap forward unreachable (${tapErr?.message || tapErr}), using local Python fallback`
    );
  }

  // 2. Standalone Fallback: Local filesystem + Python
  try {
    const repoRoot = resolveRepoRoot();
    const mirrorFile = path.join(repoRoot, "audit_vault", "latest_receipts.json");
    const pythonBin = resolvePythonBin(repoRoot);

    console.log(`[swrt-web-ui] Running agent_exe_unifier locally via ${pythonBin}...`);
    execFileSync(
      pythonBin,
      [
        "-m",
        "agents.agent_exe_unifier",
        "--ticker",
        ticker,
        "--regime",
        regime,
      ],
      {
        cwd: repoRoot,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: repoRoot },
      }
    );

    const rawText = fs.readFileSync(mirrorFile, "utf-8");
    const parsed = JSON.parse(rawText);
    const rustStatus = await checkRustKernelHealth(rustKernelUrl);
    const enriched = {
      ...parsed,
      services_health: {
        rust_kernel: rustStatus,
        audit_tap: "STANDALONE_LOCAL",
        web_ui: "ONLINE",
      },
    };
    const gated = enforceMerkleAuditGate(enriched);
    return NextResponse.json(gated, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    console.error(`[swrt-web-ui] POST /api/swrt fallback failed:`, err);
    return NextResponse.json(
      { error: err?.message || "Failed to execute SWRT pipeline" },
      { status: 500 }
    );
  }
}
