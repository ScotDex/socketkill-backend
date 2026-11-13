const SECRET = process.env.TURNSTILE_SECRET;
const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 3000;

async function verify(token) {
  if (!SECRET) {
    console.error("[TURNSTILE] secret not set");
    return false;
  }
  if (typeof token !== "string" || !token || token.length > 2048) {
    return false;
  }
  try {
    const body = new URLSearchParams({ secret: SECRET, response: token });
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    if (!data.success) {
      const codes = (data["error-codes"] || []).join(",");
      console.warn(`[TURNSTILE] rejected: ${codes}`);
    }
    return data.success === true;
  } catch (err) {
    console.warn(`[TURNSTILE] verify failed: ${err.message}`);
    return false;
  }
}

module.exports = { verify };