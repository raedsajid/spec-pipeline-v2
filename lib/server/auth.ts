import { AppError, User } from "@/lib/domain/models";
import { one, run, sha, id, now, consumeLimit, db } from "./store";
const hex = (a: Uint8Array) =>
  Array.from(a)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const bytes = (s: string) =>
  new Uint8Array(s.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: bytes(salt),
          iterations: 100000,
          hash: "SHA-256",
        },
        key,
        256,
      ),
    ),
  );
}
function constantEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}
export async function user(request: Request): Promise<User> {
  const token = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)builderp_session=([^;]+)/)?.[1];
  if (!token) throw new AppError(401, "Please sign in.");
  const u = await one<User>(
    "SELECT u.id,u.username,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
    await sha(token),
    now(),
  );
  if (!u) throw new AppError(401, "Your session has expired. Please sign in.");
  return u;
}
export function csrf(r: Request) {
  const origin = r.headers.get("origin");
  if (!origin || origin !== new URL(r.url).origin)
    throw new AppError(403, "Request origin was not accepted.");
}
export async function auth(r: Request, signup: boolean) {
  const b = (await r.json()) as any;
  const username = String(b.username || "")
      .trim()
      .toLowerCase(),
    password = String(b.password || "");
  if (
    !/^[a-z0-9_]{3,32}$/.test(username) ||
    password.length < 12 ||
    password.length > 128
  )
    throw new AppError(
      400,
      "Use a 3–32 character username (letters, numbers, underscore) and a password of 12–128 characters.",
    );
  await consumeLimit(
    "auth:" +
      (await sha(
        r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          r.headers.get("x-real-ip") ||
          r.headers.get("cf-connecting-ip") ||
          "anonymous",
      )),
    20,
    900000,
  );
  await consumeLimit("login:" + username, 10, 900000);
  let u: any = await one("SELECT * FROM users WHERE username=?", username);
  if (signup) {
    if (u) throw new AppError(409, "That username is already taken.");
    const salt = hex(crypto.getRandomValues(new Uint8Array(16))),
      hash = await derive(password, salt);
    const uid = id();
    await run(
      "INSERT INTO users (id,username,password,role,created) VALUES (?,?,?,CASE WHEN EXISTS(SELECT 1 FROM users) THEN 'member' ELSE 'admin' END,?)",
      uid,
      username,
      salt + ":" + hash,
      now(),
    );
    u = await one("SELECT * FROM users WHERE id=?", uid);
  } else {
    const salt =
      u?.password?.split(":")[0] || "00000000000000000000000000000000";
    const hash = await derive(password, salt);
    if (!u || !constantEqual(hash, u.password.split(":")[1]))
      throw new AppError(401, "Username or password is incorrect.");
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await run(
    "INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)",
    await sha(token),
    u.id,
    now() + 604800000,
  );
  return Response.json(
    { user: { id: u.id, username: u.username, role: u.role } },
    {
      headers: {
        "Set-Cookie": `builderp_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`,
        "Cache-Control": "no-store",
      },
    },
  );
}
export async function logout(r: Request) {
  const token = r.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)builderp_session=([^;]+)/)?.[1];
  if (token) await run("DELETE FROM sessions WHERE token=?", await sha(token));
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie":
          "builderp_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      },
    },
  );
}
export async function changePassword(u: User, b: any) {
  const row = await one("SELECT password FROM users WHERE id=?", u.id);
  const [salt, hash] = row.password.split(":");
  if (!constantEqual(await derive(String(b.current || ""), salt), hash))
    throw new AppError(400, "Current password is incorrect.");
  if (
    typeof b.password !== "string" ||
    b.password.length < 12 ||
    b.password.length > 128
  )
    throw new AppError(400, "Use 12–128 characters.");
  const nextSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await db().batch([
    db()
      .prepare("UPDATE users SET password=? WHERE id=?")
      .bind(nextSalt + ":" + (await derive(b.password, nextSalt)), u.id),
    db().prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
  ]);
  return { ok: true };
}
