const jwt = require("jsonwebtoken");

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const token = authHeader.substring(7);

    const secret = process.env.NHOST_JWT_SECRET;

    if (!secret) {
      console.error("NHOST_JWT_SECRET is missing");
      return res.status(500).json({
        success: false,
        error: "JWT configuration missing",
      });
    }

    jwt.verify(
      token,
      secret,
      {
        algorithms: ["HS256"],
      },
      (err, decoded) => {
        if (err) {
          console.error(
            "requireAuth: JWT verification failed:",
            err.message
          );

          return res.status(401).json({
            success: false,
            error: `Invalid or expired token: ${err.message}`,
          });
        }

        const claims =
          decoded["https://hasura.io/jwt/claims"];

        const userId =
          claims?.["x-hasura-user-id"] ||
          decoded.sub;

        if (!userId) {
          return res.status(401).json({
            success: false,
            error: "User ID not found in token",
          });
        }

        req.user = {
          id: userId,
        };

        console.log(
          "requireAuth: verified user ID =",
          req.user.id
        );

        next();
      }
    );
  } catch (error) {
    console.error(
      "requireAuth: unhandled error =",
      error
    );

    return res.status(401).json({
      success: false,
      error: "Authentication failed: " + error.message,
    });
  }
}

module.exports = {
  requireAuth,
};