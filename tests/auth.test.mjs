import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const workerUrl = new URL(`../dist/server/index.js?test=${Date.now()}`, import.meta.url);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  ALLOWED_ORIGINS: "https://recolecciontf.github.io",
  ADMIN_USERNAME: "ADMIN COMPRAS",
  ADMIN_PASSWORD_SHA256: createHash("sha256").update("admin-password").digest("hex"),
  VIEWER_USERNAME: "USUARIO COMPRAS",
  VIEWER_PASSWORD_SHA256: createHash("sha256").update("viewer-password").digest("hex"),
  SESSION_SECRET: "test-session-secret-that-is-long-enough-for-tests",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "unused@example.invalid",
  GOOGLE_PRIVATE_KEY: "unused",
  GOOGLE_SPREADSHEET_ID: "unused",
};

function api(path, init = {}) {
  return worker.fetch(new Request(`https://app.example${path}`, init), env);
}

test("rechaza una contraseña incorrecta", async () => {
  const response = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recolecciontf.github.io" },
    body: JSON.stringify({ username: "ADMIN COMPRAS", password: "incorrecta" }),
  });
  assert.equal(response.status, 401);
});

test("crea una sesión temporal y permite consultar el perfil", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://recolecciontf.github.io" },
    body: JSON.stringify({ username: "admin compras", password: "admin-password" }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("access-control-allow-origin"), "https://recolecciontf.github.io");
  const { token } = await login.json();
  assert.ok(token);

  const profile = await api("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(profile.status, 200);
  assert.deepEqual(await profile.json(), {
    displayName: "Admin compras",
    userPrincipalName: "ADMIN COMPRAS",
    role: "admin",
    canEdit: true,
  });
});

test("el usuario de consulta no puede guardar cambios", async () => {
  const login = await api("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "USUARIO COMPRAS", password: "viewer-password" }),
  });
  const { token, profile } = await login.json();
  assert.equal(profile.role, "viewer");
  assert.equal(profile.canEdit, false);

  const save = await api("/api/rows/9/review", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ review: {} }),
  });
  assert.equal(save.status, 403);
  assert.match((await save.json()).error, /consulta/);
});
