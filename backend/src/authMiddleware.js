const jwt = require("jsonwebtoken");
const jwksRsa = require("jwks-rsa");

const subdomain = process.env.NHOST_SUBDOMAIN;
const region = process.env.NHOST_REGION;

const authUrl =
  process.env.NHOST_AUTH_URL ||
  `https://${subdomain}.auth.${region}.nhost.run/v1`;

const jwksClient = jwksRsa({
  jwksUri: `${authUrl}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getKey(header, callback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }

    callback(null, key.getPublicKey());
  });
}

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

    jwt.verify(
      token,
      getKey,
      {
        algorithms: ["RS256"],
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