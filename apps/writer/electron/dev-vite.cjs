const { spawn } = require("node:child_process");
const electron = require("electron");

const env = {
  ...process.env,
  PAPERWRITER_FRONTEND_URL: process.env.PAPERWRITER_FRONTEND_URL || "http://127.0.0.1:5174",
};

const child = spawn(electron, ["."], {
  cwd: __dirname,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
