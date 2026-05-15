const attempts = new Map();

function authLimiter(req, res, next) {
  try {
    const ip =
      req.ip ||
      req.headers["x-forwarded-for"] ||
      req.connection?.remoteAddress ||
      "unknown";

    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const max = 10;

    const current = attempts.get(ip);

    if (!current) {
      attempts.set(ip, {
        count: 1,
        firstAttemptAt: now,
      });
      return next();
    }

    // reset window if expired
    if (now - current.firstAttemptAt > windowMs) {
      attempts.set(ip, {
        count: 1,
        firstAttemptAt: now,
      });
      return next();
    }

    if (current.count >= max) {
      return res.status(429).json({
        error: "Too many auth attempts. Please try again later.",
      });
    }

    current.count += 1;
    attempts.set(ip, current);

    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { authLimiter };